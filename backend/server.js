require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const pm2 = require('pm2');
const si = require('systeminformation');
const { authenticateToken } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' },
});

app.use('/api/', limiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// Serve frontend static files
const FRONTEND = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));

// Routes
const authRoutes = require('./routes/auth');
const appsRoutes = require('./routes/apps');
const systemRoutes = require('./routes/system');

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/apps', authenticateToken, appsRoutes);
app.use('/api/system', authenticateToken, systemRoutes);

// Fallback to frontend for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// Socket.io auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  const { verifyToken } = require('./middleware/auth');
  const user = verifyToken(token);
  if (!user) return next(new Error('Invalid token'));
  socket.user = user;
  next();
});

// PM2 connection
pm2.connect((err) => {
  if (err) {
    console.error('PM2 connection error:', err);
  } else {
    console.log('Connected to PM2 daemon');
  }
});

// Real-time metrics broadcast
const METRICS_INTERVAL = 3000;
let metricsInterval;

async function broadcastMetrics() {
  try {
    const [cpu, mem, disk, processes] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      new Promise((resolve) => {
        pm2.list((err, list) => resolve(err ? [] : list));
      }),
    ]);

    const diskData = disk.filter(d => d.size > 0).map(d => ({
      fs: d.fs,
      mount: d.mount,
      size: d.size,
      used: d.used,
      use: d.use,
    }));

    const metrics = {
      cpu: {
        load: Math.round(cpu.currentLoad * 10) / 10,
        cores: cpu.cpus ? cpu.cpus.length : 0,
      },
      memory: {
        total: mem.total,
        used: mem.active,
        free: mem.available,
        percent: Math.round((mem.active / mem.total) * 1000) / 10,
      },
      disk: diskData,
      processes: processes.map(formatProcess),
      timestamp: Date.now(),
    };

    io.emit('metrics', metrics);
  } catch (e) {
    // Silent - metrics are best-effort
  }
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id} (${socket.user?.username})`);

  if (!metricsInterval) {
    metricsInterval = setInterval(broadcastMetrics, METRICS_INTERVAL);
  }

  broadcastMetrics();

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (io.engine.clientsCount === 0 && metricsInterval) {
      clearInterval(metricsInterval);
      metricsInterval = null;
    }
  });

  // Tail logs for a specific app
  socket.on('subscribe:logs', (appId) => {
    socket.join(`logs:${appId}`);
  });

  socket.on('unsubscribe:logs', (appId) => {
    socket.leave(`logs:${appId}`);
  });
});

function formatProcess(proc) {
  const env = proc.pm2_env || {};
  return {
    id: proc.pm_id,
    name: proc.name,
    pid: proc.pid,
    status: env.status,
    cpu: proc.monit?.cpu ?? 0,
    memory: proc.monit?.memory ?? 0,
    uptime: env.pm_uptime,
    restarts: env.restart_time,
    instances: env.instances,
    exec_mode: env.exec_mode,
    watching: env.watch,
    version: env.version,
    node_version: env.node_version,
    script: env.pm_exec_path,
    cwd: env.pm_cwd,
    created_at: env.created_at,
    port: env.PORT || env.port || null,
  };
}

// Export for use in routes
module.exports = { io, formatProcess };

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`PM2 Monitor running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  pm2.disconnect();
  process.exit(0);
});
