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

// Finds the PM2 process (if any) running out of a site's folder, matched by cwd.
function matchProcForSite(dir, procs) {
  return procs.find(p => {
    const cwd = p.pm2_env?.pm_cwd;
    return cwd && (cwd === dir.path || cwd.startsWith(dir.path + path.sep));
  });
}

// The reverse direction: given a PM2 process, find the site name it corresponds to (if
// any), so routes/apps.js and server.js's live-metrics broadcast can accept either name
// too — see canAccessSite below for why this alias matters.
function siteNameForProc(proc, sites) {
  const cwd = proc.pm2_env?.pm_cwd;
  if (!cwd) return null;
  const site = sites.find(d => cwd === d.path || cwd.startsWith(d.path + path.sep));
  return site ? site.name : null;
}

// A nodejs site is reachable under TWO different names depending on which page you're
// on: the Applications page filters allowedApps against the PM2 process's own name
// (routes/apps.js), while this site list filters the same array against the site's
// domain/folder name. Those are often different strings for the same app, so access
// must be granted by EITHER name — otherwise a user given only one of the two names
// would be invisible on whichever page checks the other one.
function canAccessSite(user, dir, proc) {
  return canAccessApp(user, dir.name) || (proc && canAccessApp(user, proc.name));
}

async function listMergedSites(user) {
  const { sites: dirs, warnings } = discoverSites();
  let procs = [];
  try { procs = await pm2List(); } catch { procs = []; }

  const sites = dirs
    .map(d => ({ d, proc: matchProcForSite(d, procs) }))
    .filter(({ d, proc }) => canAccessSite(user, d, proc))
    .map(({ d, proc }) => ({
      id: d.id,
      name: d.name,
      type: proc ? 'nodejs' : 'static',
      path: d.path,
      itemCount: d.itemCount,
      modified: d.modified,
      pm2Id: proc ? proc.pm_id : null,
      pm2Name: proc ? proc.name : null,
      status: proc ? proc.pm2_env?.status : null,
      cpu: proc ? proc.monit?.cpu ?? 0 : null,
      memory: proc ? proc.monit?.memory ?? 0 : null,
    }));

  return { sites, warnings, homeRoot: HOME_ROOT };
}

async function resolveSite(id, user) {
  const { sites: dirs } = discoverSites();
  const match = dirs.find(d => d.id === id);
  if (!match) return null;
  let procs = [];
  try { procs = await pm2List(); } catch { procs = []; }
  if (!canAccessSite(user, match, matchProcForSite(match, procs))) return null;
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

module.exports = { HOME_ROOT, siteId, discoverSites, listMergedSites, resolveSite, safeJoin, assertSafeZipEntries, matchProcForSite, siteNameForProc, canAccessSite };
