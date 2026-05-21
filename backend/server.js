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
const { authenticateToken, verifyToken } = require('./middleware/auth');
const { initUsers } = require('./users');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false, originAgentCluster: false }));
app.use(cors());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests' },
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts' } });

app.use('/api/', limiter);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

const FRONTEND = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));

// Routes
app.use('/api/auth',   authLimiter, require('./routes/auth'));
app.use('/api/apps',   authenticateToken, require('./routes/apps'));
app.use('/api/system', authenticateToken, require('./routes/system'));
app.use('/api/users',  authenticateToken, require('./routes/users'));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(FRONTEND, 'index.html')));

// Socket auth
io.use((socket, next) => {
  const user = verifyToken(socket.handshake.auth.token);
  if (!user) return next(new Error('Invalid token'));
  socket.user = user;
  next();
});

pm2.connect(err => {
  if (err) console.error('PM2 connect error:', err);
  else console.log('Connected to PM2 daemon');
});

const INTERVAL = 3000;
let metricsTimer;

async function broadcast() {
  try {
    const [cpu, mem, disk, procs] = await Promise.all([
      si.currentLoad(), si.mem(), si.fsSize(),
      new Promise(r => pm2.list((e, l) => r(e ? [] : l))),
    ]);

    io.emit('metrics', {
      cpu: { load: Math.round(cpu.currentLoad * 10) / 10, cores: cpu.cpus?.length ?? 0 },
      memory: {
        total: mem.total, used: mem.active, free: mem.available,
        percent: Math.round(mem.active / mem.total * 1000) / 10,
      },
      disk: disk.filter(d => d.size > 0).map(d => ({ fs: d.fs, mount: d.mount, size: d.size, used: d.used, use: d.use })),
      processes: procs.map(fmtProc),
      timestamp: Date.now(),
    });
  } catch (_) {}
}

io.on('connection', socket => {
  console.log(`+ ${socket.id} (${socket.user?.username})`);
  if (!metricsTimer) metricsTimer = setInterval(broadcast, INTERVAL);
  broadcast();

  socket.on('disconnect', () => {
    console.log(`- ${socket.id}`);
    if (io.sockets.sockets.size === 0) { clearInterval(metricsTimer); metricsTimer = null; }
  });
});

function fmtProc(p) {
  const e = p.pm2_env || {};
  return {
    id: p.pm_id, name: p.name, pid: p.pid, status: e.status,
    cpu: p.monit?.cpu ?? 0, memory: p.monit?.memory ?? 0,
    uptime: e.pm_uptime, restarts: e.restart_time,
    instances: e.instances, exec_mode: e.exec_mode,
    port: e.PORT || e.port || null,
  };
}

module.exports = { io };

const PORT = process.env.PORT || 3000;

// Init users then start server
initUsers().then(() => {
  server.listen(PORT, () => console.log(`PM2 Monitor running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to init users:', err);
  process.exit(1);
});

function shutdown() { pm2.disconnect(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
