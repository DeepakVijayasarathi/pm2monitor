const express = require('express');
const pm2 = require('pm2');
const fs = require('fs');

const router = express.Router();

function pm2List() {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => (err ? reject(err) : resolve(list)));
  });
}

function pm2Action(action, id) {
  return new Promise((resolve, reject) => {
    pm2[action](id, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

function pm2Describe(id) {
  return new Promise((resolve, reject) => {
    pm2.describe(id, (err, desc) => (err ? reject(err) : resolve(desc)));
  });
}

function pm2Flush(id) {
  return new Promise((resolve, reject) => {
    pm2.flush(id, (err) => (err ? reject(err) : resolve()));
  });
}

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
    namespace: env.namespace,
  };
}

// Detect duplicate ports across PM2 apps
function detectDuplicatePorts(apps) {
  const portMap = {};
  apps.forEach((app) => {
    if (app.port) {
      const p = String(app.port);
      if (!portMap[p]) portMap[p] = [];
      portMap[p].push(app.name);
    }
  });
  const duplicates = {};
  Object.entries(portMap).forEach(([port, names]) => {
    if (names.length > 1) duplicates[port] = names;
  });
  return duplicates;
}

// GET /api/apps
router.get('/', async (req, res) => {
  try {
    const list = await pm2List();
    const apps = list.map(formatProcess);
    res.json({ apps, duplicatePorts: detectDuplicatePorts(apps) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list applications', detail: err.message });
  }
});

// GET /api/apps/:id
router.get('/:id', async (req, res) => {
  try {
    const desc = await pm2Describe(req.params.id);
    if (!desc || desc.length === 0) return res.status(404).json({ error: 'Application not found' });
    res.json(formatProcess(desc[0]));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get application', detail: err.message });
  }
});

// POST /api/apps/:id/restart
router.post('/:id/restart', async (req, res) => {
  try {
    await pm2Action('restart', req.params.id);
    res.json({ message: `Application ${req.params.id} restarted` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restart application', detail: err.message });
  }
});

// POST /api/apps/:id/stop
router.post('/:id/stop', async (req, res) => {
  try {
    await pm2Action('stop', req.params.id);
    res.json({ message: `Application ${req.params.id} stopped` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop application', detail: err.message });
  }
});

// POST /api/apps/:id/start
router.post('/:id/start', async (req, res) => {
  try {
    await pm2Action('start', req.params.id);
    res.json({ message: `Application ${req.params.id} started` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start application', detail: err.message });
  }
});

// DELETE /api/apps/:id
router.delete('/:id', async (req, res) => {
  try {
    await pm2Action('delete', req.params.id);
    res.json({ message: `Application ${req.params.id} deleted` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete application', detail: err.message });
  }
});

// GET /api/apps/:id/logs
router.get('/:id/logs', async (req, res) => {
  try {
    const desc = await pm2Describe(req.params.id);
    if (!desc || desc.length === 0) return res.status(404).json({ error: 'Application not found' });

    const proc = desc[0];
    const env = proc.pm2_env || {};
    const lines = parseInt(req.query.lines) || 100;

    const readLastLines = (filePath, n) => {
      if (!filePath || !fs.existsSync(filePath)) return [];
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.split('\n').filter(Boolean).slice(-n);
      } catch {
        return [];
      }
    };

    const outLog = readLastLines(env.pm_out_log_path, lines);
    const errLog = readLastLines(env.pm_err_log_path, lines);

    res.json({
      out: outLog,
      err: errLog,
      outPath: env.pm_out_log_path,
      errPath: env.pm_err_log_path,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve logs', detail: err.message });
  }
});

// POST /api/apps/:id/flush
router.post('/:id/flush', async (req, res) => {
  try {
    await pm2Flush(req.params.id);
    res.json({ message: `Logs flushed for application ${req.params.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to flush logs', detail: err.message });
  }
});

// POST /api/apps/restart-all
router.post('/restart-all', async (req, res) => {
  try {
    const list = await pm2List();
    await Promise.all(list.map((p) => pm2Action('restart', p.pm_id)));
    res.json({ message: 'All applications restarted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restart all applications', detail: err.message });
  }
});

module.exports = router;
