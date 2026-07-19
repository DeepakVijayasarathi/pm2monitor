const express = require('express');
const path = require('path');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { requireRole } = require('../middleware/auth');
const { listMergedSites, resolveSite } = require('../lib/sites');

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
// Viewers get just the site list; operator/admin also get discovery warnings + the configured root.
router.get('/', async (req, res) => {
  try {
    const { sites, warnings, homeRoot } = await listMergedSites(req.user);
    if (req.user.role === 'viewer') return res.json({ sites });
    res.json({ sites, warnings, homeRoot });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sites', detail: err.message });
  }
});

// POST /api/sites/:id/upload — operator + admin, uploads a .zip and extracts it into the site folder
router.post('/:id/upload', requireRole('operator', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const site = resolveSite(req.params.id, req.user);
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const destRoot = path.resolve(site.path);
    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'Invalid zip file' });
    }

    // Zip-slip guard: every entry must resolve inside destRoot before extracting anything
    for (const entry of zip.getEntries()) {
      const resolved = path.resolve(destRoot, entry.entryName);
      if (resolved !== destRoot && !resolved.startsWith(destRoot + path.sep)) {
        return res.status(400).json({ error: `Unsafe path in zip: ${entry.entryName}` });
      }
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
