const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { withLock } = require('./lib/mutex');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Dynamic per-user permissions: 5 resource categories x 3 actions (read/write/delete).
// A user's capability is whatever boxes are checked for them — there are no fixed
// admin/operator/viewer tiers anymore. "delete" is also used as the elevated tier for
// an action that doesn't literally delete anything but is comparably high-impact:
//   - apps.delete   also gates "restart ALL apps" (bulk action, not just per-app control)
//   - files.delete  also gates changing file/folder permissions (chmod)
const CATEGORIES = ['apps', 'files', 'cron', 'sites', 'users'];
const ACTIONS = ['read', 'write', 'delete'];

function emptyPermissions() {
  const p = {};
  CATEGORIES.forEach(c => { p[c] = { read: false, write: false, delete: false }; });
  return p;
}

// Read-only across apps/files/cron/sites, no user-management access — the same default
// a brand new "viewer" got under the old role system.
function defaultPermissions() {
  const p = emptyPermissions();
  ['apps', 'files', 'cron', 'sites'].forEach(c => { p[c].read = true; });
  return p;
}

function sanitizePermissions(input) {
  const p = emptyPermissions();
  if (input && typeof input === 'object') {
    CATEGORIES.forEach(c => {
      const src = input[c];
      if (src && typeof src === 'object') {
        ACTIONS.forEach(a => { p[c][a] = !!src[a]; });
      }
    });
  }
  return p;
}

function hasPermission(user, category, action) {
  return !!(user && user.permissions && user.permissions[category] && user.permissions[category][action]);
}

// Migration for records written under the old role system (still the shape of any
// users.json from before this change). Applied on every read so an already-deployed
// instance upgrades in place without an explicit migration step or losing access.
function permissionsFromLegacyRole(role) {
  const p = emptyPermissions();
  if (role === 'admin') {
    CATEGORIES.forEach(c => { p[c] = { read: true, write: true, delete: true }; });
  } else if (role === 'operator') {
    ['apps', 'files', 'cron'].forEach(c => { p[c] = { read: true, write: true, delete: false }; });
    p.sites = { read: true, write: false, delete: false };
    p.users = { read: false, write: false, delete: false };
  } else {
    // viewer, or anything unrecognized — read-only, same as defaultPermissions()
    ['apps', 'files', 'cron', 'sites'].forEach(c => { p[c].read = true; });
  }
  return p;
}

function normalizeUser(u) {
  if (u.permissions) return u;
  return { ...u, permissions: permissionsFromLegacyRole(u.role) };
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Cached by file mtime — findById/findByUsername get called on every authenticated
// request (and once per connected socket every 3s for the live-metrics broadcast), so
// re-reading and re-parsing the whole file every time doesn't scale with concurrent users.
// Callers must never mutate the returned array/objects in place (see createUser/updateUser
// below) — this cache is only ever replaced wholesale by save(), never patched, so a
// concurrent reader can't observe an in-memory change that didn't actually make it to disk.
let cache = null; // { mtimeMs, data }

function load() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const stat = fs.statSync(USERS_FILE);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).map(normalizeUser);
    cache = { mtimeMs: stat.mtimeMs, data };
    return data;
  } catch {
    return [];
  }
}

function save(users) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  cache = null; // force a fresh read (and fresh mtime) next time
}

async function initUsers() {
  const users = load();
  if (users.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'changeme', 12);
    const p = emptyPermissions();
    CATEGORIES.forEach(c => { p[c] = { read: true, write: true, delete: true }; });
    save([{
      id: crypto.randomBytes(8).toString('hex'),
      username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: hash,
      permissions: p,
      allowedApps: [],
      createdAt: new Date().toISOString(),
    }]);
    console.log('Default admin user created');
  }
}

const findByUsername = u => load().find(x => x.username === u) || null;
const findById      = id => load().find(x => x.id === id) || null;

function listUsers() {
  return load().map(({ id, username, permissions, allowedApps, createdAt }) =>
    ({ id, username, permissions, allowedApps: allowedApps || [], created_at: createdAt }));
}

function sanitizeAllowedApps(allowedApps) {
  if (!Array.isArray(allowedApps)) return [];
  return [...new Set(allowedApps.map(a => String(a).trim()).filter(Boolean))];
}

// Empty allowedApps means unrestricted (all apps). Unlike the old role system, this is
// fully independent of what a user can DO (their permissions) — a user can be granted
// every permission and still be scoped to a handful of apps, or vice versa.
function canAccessApp(user, appName) {
  if (!user) return false;
  if (!user.allowedApps || user.allowedApps.length === 0) return true;
  return user.allowedApps.includes(appName);
}

// Every mutation below is serialized through the 'users' lock so concurrent requests
// can't interleave a load() from one with a save() from another and lose an update
// (e.g. two concurrent deletes of the last users.write-capable account both reading
// "one left").
async function createUser(username, password, permissions, allowedApps) {
  return withLock('users', async () => {
    const users = load();
    if (users.find(u => u.username === username.trim())) throw new Error('Username already exists');
    const user = {
      id: crypto.randomBytes(8).toString('hex'),
      username: username.trim(),
      passwordHash: await bcrypt.hash(password, 12),
      permissions: sanitizePermissions(permissions),
      allowedApps: sanitizeAllowedApps(allowedApps),
      createdAt: new Date().toISOString(),
    };
    save([...users, user]);
    return { id: user.id, username: user.username, permissions: user.permissions, allowedApps: user.allowedApps, created_at: user.createdAt };
  });
}

async function updateUser(id, { username, permissions, password, allowedApps } = {}) {
  return withLock('users', async () => {
    const users = load();
    const i = users.findIndex(u => u.id === id);
    if (i === -1) throw new Error('User not found');
    const updated = { ...users[i] };
    if (permissions) updated.permissions = sanitizePermissions(permissions);
    if (username) {
      if (users.find(u => u.username === username.trim() && u.id !== id)) throw new Error('Username already taken');
      updated.username = username.trim();
    }
    if (allowedApps !== undefined) updated.allowedApps = sanitizeAllowedApps(allowedApps);
    if (password) updated.passwordHash = await bcrypt.hash(password, 12);
    const newUsers = [...users];
    newUsers[i] = updated;
    save(newUsers);
    return { id: updated.id, username: updated.username, permissions: updated.permissions, allowedApps: updated.allowedApps || [], created_at: updated.createdAt };
  });
}

async function deleteUser(id) {
  return withLock('users', async () => {
    const users = load();
    const user = users.find(u => u.id === id);
    if (!user) throw new Error('User not found');
    if (hasPermission(user, 'users', 'write')) {
      const others = users.filter(u => u.id !== id && hasPermission(u, 'users', 'write'));
      if (others.length === 0) throw new Error('Cannot delete the last user with Users → Write permission');
    }
    save(users.filter(u => u.id !== id));
  });
}

module.exports = {
  initUsers, findByUsername, findById, listUsers, createUser, updateUser, deleteUser,
  canAccessApp, hasPermission, sanitizePermissions, defaultPermissions,
  CATEGORIES, ACTIONS,
};
