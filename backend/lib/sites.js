const fs = require('fs');
const path = require('path');
const pm2 = require('pm2');
const { canAccessApp } = require('../users');

// CloudPanel-style layout: <HOME>/<cp-user>/htdocs/<site>
const HOME_ROOT = process.env.CLOUDPANEL_HOME || '/home';

const pm2List = () => new Promise((res, rej) => pm2.list((e, l) => e ? rej(e) : res(l)));

function siteId(cpUser, site) {
  return Buffer.from(`${cpUser}/${site}`).toString('base64url');
}

// Scans HOME_ROOT for <cp-user>/htdocs/<site> dirs. Read failures (permissions,
// missing path) are collected as warnings instead of silently skipped, so a
// misconfigured root or a permissions problem is visible to the caller.
function discoverSites() {
  const sites = [];
  const warnings = [];

  if (!fs.existsSync(HOME_ROOT)) {
    warnings.push({ path: HOME_ROOT, error: 'Apps root does not exist' });
    return { sites, warnings };
  }

  let cpUsers;
  try {
    cpUsers = fs.readdirSync(HOME_ROOT);
  } catch (err) {
    warnings.push({ path: HOME_ROOT, error: err.message });
    return { sites, warnings };
  }

  for (const cpUser of cpUsers) {
    const htdocs = path.join(HOME_ROOT, cpUser, 'htdocs');
    let stat;
    try {
      stat = fs.statSync(htdocs);
    } catch (err) {
      if (err.code !== 'ENOENT') warnings.push({ path: htdocs, error: err.message });
      continue;
    }
    if (!stat.isDirectory()) continue;

    let siteNames;
    try {
      siteNames = fs.readdirSync(htdocs);
    } catch (err) {
      warnings.push({ path: htdocs, error: err.message });
      continue;
    }

    for (const site of siteNames) {
      const sitePath = path.join(htdocs, site);
      let siteStat;
      try {
        siteStat = fs.statSync(sitePath);
      } catch (err) {
        warnings.push({ path: sitePath, error: err.message });
        continue;
      }
      if (!siteStat.isDirectory()) continue;

      let itemCount = 0;
      try {
        itemCount = fs.readdirSync(sitePath).length;
      } catch (err) {
        warnings.push({ path: sitePath, error: err.message });
      }

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

  return { sites, warnings };
}

async function listMergedSites(user) {
  const { sites: dirs, warnings } = discoverSites();
  let procs = [];
  try { procs = await pm2List(); } catch { procs = []; }

  const sites = dirs
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

  return { sites, warnings, homeRoot: HOME_ROOT };
}

function resolveSite(id, user) {
  const { sites: dirs } = discoverSites();
  const match = dirs.find(d => d.id === id);
  if (!match) return null;
  if (!canAccessApp(user, match.name)) return null;
  return match;
}

// Resolves relPath against root and rejects anything that escapes it (path traversal guard)
function safeJoin(root, relPath) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relPath || '.');
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Unsafe path: ${relPath}`);
  }
  return target;
}

// Zip-slip guard: every entry must resolve inside destRoot. Throws on the first unsafe entry.
function assertSafeZipEntries(zip, destRoot) {
  const resolvedRoot = path.resolve(destRoot);
  for (const entry of zip.getEntries()) {
    const resolved = path.resolve(resolvedRoot, entry.entryName);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Unsafe path in zip: ${entry.entryName}`);
    }
  }
}

module.exports = { HOME_ROOT, siteId, discoverSites, listMergedSites, resolveSite, safeJoin, assertSafeZipEntries };
