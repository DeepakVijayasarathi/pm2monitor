const express = require('express');
const si = require('systeminformation');
const net = require('net');

const router = express.Router();

// Check if a port is in use
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve({ port, inUse: true }));
    server.once('listening', () => {
      server.close();
      resolve({ port, inUse: false });
    });
    server.listen(port, '127.0.0.1');
  });
}

// GET /api/system/stats
router.get('/stats', async (req, res) => {
  try {
    const [cpu, mem, disk, cpuInfo, osInfo, networkStats] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.cpu(),
      si.osInfo(),
      si.networkStats(),
    ]);

    const diskData = disk
      .filter((d) => d.size > 0)
      .map((d) => ({
        fs: d.fs,
        type: d.type,
        mount: d.mount,
        size: d.size,
        used: d.used,
        available: d.available,
        use: Math.round(d.use * 10) / 10,
      }));

    const netData = networkStats.slice(0, 3).map((n) => ({
      iface: n.iface,
      rx_bytes: n.rx_bytes,
      tx_bytes: n.tx_bytes,
      rx_sec: n.rx_sec,
      tx_sec: n.tx_sec,
    }));

    res.json({
      cpu: {
        load: Math.round(cpu.currentLoad * 10) / 10,
        idle: Math.round(cpu.currentLoadIdle * 10) / 10,
        cores: cpuInfo.cores,
        physicalCores: cpuInfo.physicalCores,
        brand: cpuInfo.brand,
        speed: cpuInfo.speed,
        perCore: (cpu.cpus || []).map((c) => Math.round(c.load * 10) / 10),
      },
      memory: {
        total: mem.total,
        used: mem.active,
        free: mem.available,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
        percent: Math.round((mem.active / mem.total) * 1000) / 10,
      },
      disk: diskData,
      network: netData,
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        hostname: osInfo.hostname,
        arch: osInfo.arch,
        uptime: osInfo.uptime,
      },
      timestamp: Date.now(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve system stats', detail: err.message });
  }
});

// GET /api/system/ports?ports=3000,8080,8443
router.get('/ports', async (req, res) => {
  try {
    const rawPorts = (req.query.ports || '').split(',').map(Number).filter((p) => p > 0 && p < 65536);
    if (rawPorts.length === 0) {
      return res.status(400).json({ error: 'Provide comma-separated port numbers in ?ports=' });
    }
    const results = await Promise.all(rawPorts.map(checkPort));
    res.json({ ports: results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check ports', detail: err.message });
  }
});

module.exports = router;
