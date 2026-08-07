const express = require('express');
const path = require('path');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { requirePermission } = require('../middleware/auth');
const { hasPermission } = require('../users');
const { listMergedSites, resolveSite, assertSafeZipEntries } = require('../lib/sites');

const router = express.Router();

const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!/\.zip$/i.test(file.originalname)) return cb(new Error('Only .zip files are accepted'));
    cb(null, true);
  },
});

// GET /api/sites — all authenticated users, filtered to allowed apps.
// The site list itself stays visible to anyone authenticated (files/cron/deploy pages
// all need it just to navigate); users without sites.write get the list only, while
// sites.write-capable users also get discovery warnings + the configured root.
router.get('/', async (req, res) => {
  try {
    const { sites, warnings, homeRoot } = await listMergedSites(req.user);
    if (!hasPermission(req.user, 'sites', 'write')) return res.json({ sites });
    res.json({ sites, warnings, homeRoot });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sites', detail: err.message });
  }
});

// POST /api/sites/:id/upload — files.write, uploads a .zip and extracts it into the site folder
router.post('/:id/upload', requirePermission('files', 'write'), upload.single('file'), async (req, res) => {
  try {
    const site = await resolveSite(req.params.id, req.user);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const destRoot = path.resolve(site.path);
    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'Invalid zip file' });
    }

    try {
      assertSafeZipEntries(zip, destRoot);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    zip.extractAllTo(destRoot, true);
    res.json({ message: `Deployed to ${site.name}`, extractedFiles: zip.getEntries().length });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

// Multer errors (bad file type, too large) land here instead of Express's default HTML handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
  next();
});

module.exports = router;
