const express = require('express');
const pm2 = require('pm2');
const fs = require('fs');
const { requireRole } = require('../middleware/auth');
const { canAccessApp } = require('../users');
const { discoverSites, siteNameForProc } = require('../lib/sites');

const router = express.Router();

// A nodejs app is reachable under two different names: its own PM2 process name (this
// page) and its site's domain/folder name (All Applications page, matched by cwd). A
// user granted only one of the two must still be allowed in here by either name.
function canAccessProc(user, proc, sites) {
  return canAccessApp(user, proc.name) || canAccessApp(user, siteNameForProc(proc, sites));
}

// Resolves :id to its pm2 process name and blocks access if the user isn't allowed to see it
async function requireAppAccess(req, res, next) {
  try {
    const d = await pm2Describe(req.params.id);
    if (!d || !d.length) return res.status(404).json({ error: 'Application not found' });
    const { sites } = discoverSites();
    if (!canAccessProc(req.user, d[0], sites)) {
      return res.status(403).json({ error: 'You do not have access to this application' });
    }
    req.pm2App = d[0];
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to look up application', detail: err.message });
  }
}

// ---- PM2 helpers ----
const pm2List     = () => new Promise((res, rej) => pm2.list((e, l) => e ? rej(e) : res(l)));
const pm2Describe = id => new Promise((res, rej) => pm2.describe(id, (e, d) => e ? rej(e) : res(d)));
const pm2Flush    = id => new Promise((res, rej) => pm2.flush(id, e => e ? rej(e) : res()));
const pm2Do       = (action, id) => new Promise((res, rej) => pm2[action](id, (e, r) => e ? rej(e) : res(r)));

function fmt(proc) {
  const e = proc.pm2_env || {};
  return {
    id: proc.pm_id, name: proc.name, pid: proc.pid,
    status: e.status,
    cpu: proc.monit?.cpu ?? 0,
    memory: proc.monit?.memory ?? 0,
    uptime: e.pm_uptime,
    restarts: e.restart_time,
    instances: e.instances,
    exec_mode: e.exec_mode,
    watching: e.watch,
    version: e.version,
    node_version: e.node_version,
    script: e.pm_exec_path,
    cwd: e.pm_cwd,
    created_at: e.created_at,
    port: e.PORT || e.port || null,
    namespace: e.namespace,
    out_log: e.pm_out_log_path,
    err_log: e.pm_err_log_path,
  };
}

function dupPorts(apps) {
  const m = {};
  apps.forEach(a => { if (a.port) { const p = String(a.port); (m[p] = m[p] || []).push(a.name); } });
  const d = {};
  Object.entries(m).forEach(([p, n]) => { if (n.length > 1) d[p] = n; });
  return d;
}

// POST /restart-all — MUST be before /:id routes to avoid param capture
router.post('/restart-all', requireRole('admin'), async (req, res) => {
  try {
    const list = await pm2List();
    await Promise.all(list.map(p => pm2Do('restart', p.pm_id)));
    res.json({ message: 'All applications restarted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restart all', detail: err.message });
  }
});

// GET / — all authenticated users (viewer, operator, admin), filtered to allowed apps
router.get('/', async (req, res) => {
  try {
    const list = await pm2List();
    const { sites } = discoverSites();
    const apps = list.filter(p => canAccessProc(req.user, p, sites)).map(fmt);
    res.json({ apps, duplicatePorts: dupPorts(apps) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list applications', detail: err.message });
  }
});

// GET /:id
router.get('/:id', requireAppAccess, async (req, res) => {
  try {
    res.json(fmt(req.pm2App));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get application', detail: err.message });
  }
});

// GET /:id/logs
router.get('/:id/logs', requireAppAccess, async (req, res) => {
  try {
    const d = [req.pm2App];
    const env = d[0].pm2_env || {};
    const lines = Math.min(parseInt(req.query.lines) || 200, 2000);

    const readLines = (p, n) => {
      if (!p || !fs.existsSync(p)) return [];
      try {
        return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n);
      } catch { return []; }
    };

    res.json({
      out: readLines(env.pm_out_log_path, lines),
      err: readLines(env.pm_err_log_path, lines),
      outPath: env.pm_out_log_path,
      errPath: env.pm_err_log_path,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve logs', detail: err.message });
  }
});

// POST /:id/restart — operator + admin
router.post('/:id/restart', requireRole('operator', 'admin'), requireAppAccess, async (req, res) => {
  try {
    await pm2Do('restart', req.params.id);
    res.json({ message: `Restarted ${req.params.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restart', detail: err.message });
  }
});

// POST /:id/stop — operator + admin
router.post('/:id/stop', requireRole('operator', 'admin'), requireAppAccess, async (req, res) => {
  try {
    await pm2Do('stop', req.params.id);
    res.json({ message: `Stopped ${req.params.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop', detail: err.message });
  }
});

// POST /:id/start — operator + admin
router.post('/:id/start', requireRole('operator', 'admin'), requireAppAccess, async (req, res) => {
  try {
    await pm2Do('start', req.params.id);
    res.json({ message: `Started ${req.params.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start', detail: err.message });
  }
});

// POST /:id/flush — operator + admin
router.post('/:id/flush', requireRole('operator', 'admin'), requireAppAccess, async (req, res) => {
  try {
    await pm2Flush(req.params.id);
    res.json({ message: `Logs flushed for ${req.params.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to flush logs', detail: err.message });
  }
});

// DELETE /:id — admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pm2Do('delete', req.params.id);
    res.json({ message: `Deleted ${req.params.id}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', detail: err.message });
  }
});

module.exports = router;
