const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { requireRole } = require('../middleware/auth');
const { resolveSite, safeJoin } = require('../lib/sites');

const router = express.Router();

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function siteRootOr404(req, res) {
  const site = resolveSite(req.params.id, req.user);
  if (!site) { res.status(404).json({ error: 'Site not found' }); return null; }
  return site;
}

function resolvePathOr400(root, relPath, res) {
  try {
    return safeJoin(root, relPath || '.');
  } catch (err) {
    res.status(400).json({ error: err.message });
    return null;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

// GET /api/sites/:id/files?path= — list a directory
router.get('/:id/files', async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const target = resolvePathOr400(site.path, req.query.path, res);
    if (!target) return;

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat) return res.status(404).json({ error: 'Path not found' });
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const names = await fs.promises.readdir(target);
    const entries = await Promise.all(names.map(async name => {
      const full = path.join(target, name);
      let s;
      try { s = await fs.promises.stat(full); } catch { return null; }
      return {
        name,
        type: s.isDirectory() ? 'dir' : 'file',
        size: s.isDirectory() ? null : s.size,
        modified: s.mtime,
      };
    }));

    const list = entries.filter(Boolean).sort((a, b) =>
      a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name));

    res.json({ path: path.relative(site.path, target).split(path.sep).join('/'), entries: list });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list directory', detail: err.message });
  }
});

// GET /api/sites/:id/files/content?path= — read a text file
router.get('/:id/files/content', async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const target = resolvePathOr400(site.path, req.query.path, res);
    if (!target) return;

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) return res.status(404).json({ error: 'File not found' });

    const fh = await fs.promises.open(target, 'r');
    try {
      const buf = Buffer.alloc(Math.min(stat.size, MAX_TEXT_BYTES));
      await fh.read(buf, 0, buf.length, 0);
      res.json({ content: buf.toString('utf8'), truncated: stat.size > MAX_TEXT_BYTES, size: stat.size });
    } finally {
      await fh.close();
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file', detail: err.message });
  }
});

// PUT /api/sites/:id/files/content — save file content
router.put('/:id/files/content', requireRole('operator', 'admin'), express.json({ limit: '3mb' }), async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const { path: relPath, content } = req.body || {};
    if (typeof relPath !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: 'path and content are required' });
    }
    const target = resolvePathOr400(site.path, relPath, res);
    if (!target) return;

    const stat = await fs.promises.stat(target).catch(() => null);
    if (stat && stat.isDirectory()) return res.status(400).json({ error: 'Cannot write to a directory' });

    await fs.promises.writeFile(target, content, 'utf8');
    res.json({ message: 'Saved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save file', detail: err.message });
  }
});

// POST /api/sites/:id/files/mkdir — create a folder
router.post('/:id/files/mkdir', requireRole('operator', 'admin'), express.json(), async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const { path: relPath } = req.body || {};
    if (!relPath) return res.status(400).json({ error: 'path is required' });
    const target = resolvePathOr400(site.path, relPath, res);
    if (!target) return;

    await fs.promises.mkdir(target, { recursive: true });
    res.json({ message: 'Folder created' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create folder', detail: err.message });
  }
});

// POST /api/sites/:id/files/rename — rename/move within the site root
router.post('/:id/files/rename', requireRole('operator', 'admin'), express.json(), async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
    const fromPath = resolvePathOr400(site.path, from, res);
    if (!fromPath) return;
    const toPath = resolvePathOr400(site.path, to, res);
    if (!toPath) return;

    const exists = await fs.promises.stat(fromPath).catch(() => null);
    if (!exists) return res.status(404).json({ error: 'Source not found' });

    await fs.promises.rename(fromPath, toPath);
    res.json({ message: 'Renamed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename', detail: err.message });
  }
});

// DELETE /api/sites/:id/files?path= — delete a file, or a folder (recursive delete is admin-only)
router.delete('/:id/files', requireRole('operator', 'admin'), async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const target = resolvePathOr400(site.path, req.query.path, res);
    if (!target) return;
    if (target === path.resolve(site.path)) return res.status(400).json({ error: 'Cannot delete the app root' });

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat) return res.status(404).json({ error: 'Path not found' });

    if (stat.isDirectory()) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Deleting a folder requires the admin role' });
      }
      await fs.promises.rm(target, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(target);
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', detail: err.message });
  }
});

// GET /api/sites/:id/files/download?path= — stream a file download
router.get('/:id/files/download', async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const target = resolvePathOr400(site.path, req.query.path, res);
    if (!target) return;

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) return res.status(404).json({ error: 'File not found' });

    res.download(target);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download file', detail: err.message });
  }
});

// POST /api/sites/:id/files/upload — upload individual file(s) into a directory
router.post('/:id/files/upload', requireRole('operator', 'admin'), upload.array('files', 20), async (req, res) => {
  try {
    const site = siteRootOr404(req, res);
    if (!site) return;
    const target = resolvePathOr400(site.path, req.query.path, res);
    if (!target) return;

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat || !stat.isDirectory()) return res.status(400).json({ error: 'Target directory not found' });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });

    for (const f of req.files) {
      const dest = resolvePathOr400(target, f.originalname, res);
      if (!dest) return;
      await fs.promises.writeFile(dest, f.buffer);
    }
    res.json({ message: `Uploaded ${req.files.length} file(s)` });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

// Multer errors land here instead of Express's default HTML handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message || 'Request failed' });
  }
  next();
});

module.exports = router;
