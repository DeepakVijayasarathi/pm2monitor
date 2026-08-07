const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { resolveSite } = require('../lib/sites');
const cron = require('../lib/crontab');
const audit = require('../lib/audit');

const router = express.Router();

async function siteRootOr404(req, res) {
  const site = await resolveSite(req.params.id, req.user);
  if (!site) { res.status(404).json({ error: 'Site not found' }); return null; }
  return site;
}

// GET /api/sites/:id/cron — cron.read
router.get('/:id/cron', requirePermission('cron', 'read'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const entries = await cron.listEntries(site.cpUser);
    res.json({ user: site.cpUser, entries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read crontab', detail: err.message });
  }
});

// POST /api/sites/:id/cron — cron.write
router.post('/:id/cron', requirePermission('cron', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { schedule, command } = req.body || {};
    await cron.addEntry(site.cpUser, schedule, command);
    audit.log(req.user, 'cron.add', site.name, { schedule, command });
    res.json({ message: 'Cron job added' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to add cron job', detail: err.message });
  }
});

// PUT /api/sites/:id/cron/:index — cron.write
router.put('/:id/cron/:index', requirePermission('cron', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { schedule, command } = req.body || {};
    await cron.updateEntry(site.cpUser, Number(req.params.index), schedule, command);
    audit.log(req.user, 'cron.update', site.name, { index: req.params.index, schedule, command });
    res.json({ message: 'Cron job updated' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update cron job', detail: err.message });
  }
});

// DELETE /api/sites/:id/cron/:index — cron.delete
router.delete('/:id/cron/:index', requirePermission('cron', 'delete'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    await cron.deleteEntry(site.cpUser, Number(req.params.index));
    audit.log(req.user, 'cron.delete', site.name, { index: req.params.index });
    res.json({ message: 'Cron job deleted' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to delete cron job', detail: err.message });
  }
});

module.exports = router;
