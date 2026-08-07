const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { requirePermission } = require('../middleware/auth');
const { resolveSite, safeJoin, assertSafeZipEntries } = require('../lib/sites');
const audit = require('../lib/audit');

const router = express.Router();

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

async function siteRootOr404(req, res) {
  const site = await resolveSite(req.params.id, req.user);
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
router.get('/:id/files', requirePermission('files', 'read'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
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
        mode: (s.mode & 0o777).toString(8).padStart(3, '0'),
        uid: s.uid,
        gid: s.gid,
      };
    }));

    const list = entries.filter(Boolean).sort((a, b) =>
      a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name));

    res.json({ path: path.relative(site.path, target).split(path.sep).join('/'), entries: list, owner: site.cpUser });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list directory', detail: err.message });
  }
});

// GET /api/sites/:id/files/content?path= — read a text file
router.get('/:id/files/content', requirePermission('files', 'read'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
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
router.put('/:id/files/content', requirePermission('files', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
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
router.post('/:id/files/mkdir', requirePermission('files', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
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
router.post('/:id/files/rename', requirePermission('files', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
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

// POST /api/sites/:id/files/copy — copy a file or folder (recursive) within the site root
router.post('/:id/files/copy', requirePermission('files', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
    const fromPath = resolvePathOr400(site.path, from, res);
    if (!fromPath) return;
    const toPath = resolvePathOr400(site.path, to, res);
    if (!toPath) return;

    const exists = await fs.promises.stat(fromPath).catch(() => null);
    if (!exists) return res.status(404).json({ error: 'Source not found' });

    await fs.promises.cp(fromPath, toPath, { recursive: true, errorOnExist: true, force: false });
    res.json({ message: 'Copied' });
  } catch (err) {
    if (err.code === 'ERR_FS_CP_EEXIST' || err.code === 'EEXIST') {
      return res.status(400).json({ error: 'Destination already exists' });
    }
    res.status(500).json({ error: 'Failed to copy', detail: err.message });
  }
});

// PUT /api/sites/:id/files/permissions — chmod. Grouped under files.delete (the
// elevated tier for the files category) rather than files.write, same as the old
// admin-only gate — this changes ownership/mode bits on disk, a bigger blast radius
// than ordinary file edits.
router.put('/:id/files/permissions', requirePermission('files', 'delete'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { path: relPath, mode } = req.body || {};
    if (!/^[0-7]{3}$/.test(mode || '')) return res.status(400).json({ error: 'mode must be 3 octal digits, e.g. 755' });
    const target = resolvePathOr400(site.path, relPath, res);
    if (!target) return;

    const exists = await fs.promises.stat(target).catch(() => null);
    if (!exists) return res.status(404).json({ error: 'Path not found' });

    await fs.promises.chmod(target, parseInt(mode, 8));
    audit.log(req.user, 'file.chmod', `${site.name}:${relPath}`, { mode });
    res.json({ message: `Permissions set to ${mode}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change permissions', detail: err.message });
  }
});

// POST /api/sites/:id/files/extract — extract a .zip already on the server into a sibling folder
router.post('/:id/files/extract', requirePermission('files', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { path: relPath } = req.body || {};
    if (!/\.zip$/i.test(relPath || '')) return res.status(400).json({ error: 'path must point to a .zip file' });
    const target = resolvePathOr400(site.path, relPath, res);
    if (!target) return;

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) return res.status(404).json({ error: 'Zip file not found' });

    const destName = path.basename(target).replace(/\.zip$/i, '');
    const destRoot = resolvePathOr400(path.dirname(target), destName, res);
    if (!destRoot) return;

    let zip;
    try {
      zip = new AdmZip(target);
    } catch {
      return res.status(400).json({ error: 'Invalid zip file' });
    }

    try {
      assertSafeZipEntries(zip, destRoot);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    zip.extractAllTo(destRoot, true);
    res.json({ message: `Extracted to ${destName}`, extractedFiles: zip.getEntries().length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to extract', detail: err.message });
  }
});

// POST /api/sites/:id/files/compress — compress selected files/folders into a new .zip in the current dir
router.post('/:id/files/compress', requirePermission('files', 'write'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { paths, name } = req.body || {};
    if (!Array.isArray(paths) || !paths.length) return res.status(400).json({ error: 'paths is required' });
    if (!/^[^/\\]+\.zip$/i.test(name || '')) return res.status(400).json({ error: 'name must be a plain filename ending in .zip' });

    const zipDest = resolvePathOr400(site.path, name, res);
    if (!zipDest) return;
    if (await fs.promises.stat(zipDest).catch(() => null)) return res.status(400).json({ error: 'A file with that name already exists' });

    const zip = new AdmZip();
    for (const relPath of paths) {
      const target = resolvePathOr400(site.path, relPath, res);
      if (!target) return;
      const stat = await fs.promises.stat(target).catch(() => null);
      if (!stat) return res.status(404).json({ error: `Not found: ${relPath}` });
      if (stat.isDirectory()) zip.addLocalFolder(target, path.basename(target));
      else zip.addLocalFile(target);
    }
    zip.writeZip(zipDest);
    res.json({ message: `Created ${name}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compress', detail: err.message });
  }
});

// DELETE /api/sites/:id/files/bulk — delete multiple files/folders
router.delete('/:id/files/bulk', requirePermission('files', 'delete'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { paths } = req.body || {};
    if (!Array.isArray(paths) || !paths.length) return res.status(400).json({ error: 'paths is required' });

    const results = [];
    for (const relPath of paths) {
      try {
        const target = safeJoin(site.path, relPath);
        if (target === path.resolve(site.path)) throw new Error('Cannot delete the app root');
        const stat = await fs.promises.stat(target).catch(() => null);
        if (!stat) throw new Error('Not found');
        if (stat.isDirectory()) {
          await fs.promises.rm(target, { recursive: true, force: true });
        } else {
          await fs.promises.unlink(target);
        }
        results.push({ path: relPath, ok: true });
      } catch (err) {
        results.push({ path: relPath, ok: false, error: err.message });
      }
    }
    audit.log(req.user, 'file.bulk_delete', site.name, { results });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Bulk delete failed', detail: err.message });
  }
});

// POST /api/sites/:id/files/bulk-download — zip up a selection and stream it back
router.post('/:id/files/bulk-download', requirePermission('files', 'read'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const { paths } = req.body || {};
    if (!Array.isArray(paths) || !paths.length) return res.status(400).json({ error: 'paths is required' });

    const zip = new AdmZip();
    for (const relPath of paths) {
      const target = resolvePathOr400(site.path, relPath, res);
      if (!target) return;
      const stat = await fs.promises.stat(target).catch(() => null);
      if (!stat) return res.status(404).json({ error: `Not found: ${relPath}` });
      if (stat.isDirectory()) zip.addLocalFolder(target, path.basename(target));
      else zip.addLocalFile(target);
    }

    const buf = zip.toBuffer();
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${site.name}-selection.zip"`,
      'Content-Length': buf.length,
    });
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: 'Failed to build zip', detail: err.message });
  }
});

// DELETE /api/sites/:id/files?path= — delete a file or a folder (recursive)
router.delete('/:id/files', requirePermission('files', 'delete'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
    if (!site) return;
    const target = resolvePathOr400(site.path, req.query.path, res);
    if (!target) return;
    if (target === path.resolve(site.path)) return res.status(400).json({ error: 'Cannot delete the app root' });

    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat) return res.status(404).json({ error: 'Path not found' });

    if (stat.isDirectory()) {
      await fs.promises.rm(target, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(target);
    }
    audit.log(req.user, 'file.delete', `${site.name}:${req.query.path}`, { type: stat.isDirectory() ? 'dir' : 'file' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete', detail: err.message });
  }
});

// GET /api/sites/:id/files/download?path= — stream a file download
router.get('/:id/files/download', requirePermission('files', 'read'), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
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
router.post('/:id/files/upload', requirePermission('files', 'write'), upload.array('files', 20), async (req, res) => {
  try {
    const site = await siteRootOr404(req, res);
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
