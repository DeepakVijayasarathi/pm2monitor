const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const AdmZip = require('adm-zip');
const pm2 = require('pm2');
const { requireRole } = require('../middleware/auth');
const { canAccessApp } = require('../users');

const router = express.Router();

// CloudPanel-style layout: <HOME>/<cp-user>/htdocs/<site>
const HOME_ROOT = process.env.CLOUDPANEL_HOME || '/home';
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!/\.zip$/i.test(file.originalname)) return cb(new Error('Only .zip files are accepted'));
    cb(null, true);
  },
});

const pm2List = () => new Promise((res, rej) => pm2.list((e, l) => e ? rej(e) : res(l)));

function siteId(cpUser, site) {
  return Buffer.from(`${cpUser}/${site}`).toString('base64url');
}

function discoverSites() {
  const sites = [];
  if (!fs.existsSync(HOME_ROOT)) return sites;
  for (const cpUser of fs.readdirSync(HOME_ROOT)) {
    const htdocs = path.join(HOME_ROOT, cpUser, 'htdocs');
    let stat;
    try { stat = fs.statSync(htdocs); } catch { continue; }
    if (!stat.isDirectory()) continue;
    for (const site of fs.readdirSync(htdocs)) {
      const sitePath = path.join(htdocs, site);
      let siteStat;
      try { siteStat = fs.statSync(sitePath); } catch { continue; }
      if (!siteStat.isDirectory()) continue;
      let itemCount = 0;
      try { itemCount = fs.readdirSync(sitePath).length; } catch {}
      sites.push({
        id: siteId(cpUser, site),
        name: site,
        cpUser,
        path: sitePath,
        itemCount,
        modified: siteStat.mtime,
      });
    }
  }
  return sites;
}

async function listMergedSites(user) {
  const dirs = discoverSites();
  let procs = [];
  try { procs = await pm2List(); } catch { procs = []; }

  return dirs
    .filter(d => canAccessApp(user, d.name))
    .map(d => {
      const proc = procs.find(p => {
        const cwd = p.pm2_env?.pm_cwd;
        return cwd && (cwd === d.path || cwd.startsWith(d.path + path.sep));
      });
      return {
        id: d.id,
        name: d.name,
        type: proc ? 'nodejs' : 'static',
        path: d.path,
        itemCount: d.itemCount,
        modified: d.modified,
        pm2Id: proc ? proc.pm_id : null,
        status: proc ? proc.pm2_env?.status : null,
        cpu: proc ? proc.monit?.cpu ?? 0 : null,
        memory: proc ? proc.monit?.memory ?? 0 : null,
      };
    });
}

function resolveSite(id, user) {
  const dirs = discoverSites();
  const match = dirs.find(d => d.id === id);
  if (!match) return null;
  if (!canAccessApp(user, match.name)) return null;
  return match;
}

// GET /api/sites — all authenticated users, filtered to allowed apps
router.get('/', async (req, res) => {
  try {
    res.json({ sites: await listMergedSites(req.user) });
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
