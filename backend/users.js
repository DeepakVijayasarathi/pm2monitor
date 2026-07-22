const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { withLock } = require('./lib/mutex');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// admin  : full access including user management
// operator: restart/stop/start/flush apps — no delete, no user management
// viewer  : read-only
const ROLES = ['admin', 'operator', 'viewer'];

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
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
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
    save([{
      id: crypto.randomBytes(8).toString('hex'),
      username: process.env.ADMIN_USERNAME || 'admin',
      passwordHash: hash,
      role: 'admin',
      createdAt: new Date().toISOString(),
    }]);
    console.log('Default admin user created');
  }
}

const findByUsername = u => load().find(x => x.username === u) || null;
const findById      = id => load().find(x => x.id === id) || null;

function listUsers() {
  return load().map(({ id, username, role, allowedApps, createdAt }) =>
    ({ id, username, role, allowedApps: allowedApps || [], created_at: createdAt }));
}

function sanitizeAllowedApps(allowedApps) {
  if (!Array.isArray(allowedApps)) return [];
  return [...new Set(allowedApps.map(a => String(a).trim()).filter(Boolean))];
}

// Empty allowedApps means unrestricted (all apps). Admins are always unrestricted.
function canAccessApp(user, appName) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.allowedApps || user.allowedApps.length === 0) return true;
  return user.allowedApps.includes(appName);
}

// Every mutation below is serialized through the 'users' lock so concurrent requests
// can't interleave a load() from one with a save() from another and lose an update
// (e.g. two concurrent deletes of different admins both reading "2 admins left").
async function createUser(username, password, role, allowedApps) {
  return withLock('users', async () => {
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    const users = load();
    if (users.find(u => u.username === username.trim())) throw new Error('Username already exists');
    const user = {
      id: crypto.randomBytes(8).toString('hex'),
      username: username.trim(),
      passwordHash: await bcrypt.hash(password, 12),
      role,
      allowedApps: sanitizeAllowedApps(allowedApps),
      createdAt: new Date().toISOString(),
    };
    save([...users, user]);
    return { id: user.id, username: user.username, role: user.role, allowedApps: user.allowedApps, created_at: user.createdAt };
  });
}

async function updateUser(id, { username, role, password, allowedApps } = {}) {
  return withLock('users', async () => {
    const users = load();
    const i = users.findIndex(u => u.id === id);
    if (i === -1) throw new Error('User not found');
    const updated = { ...users[i] };
    if (role) {
      if (!ROLES.includes(role)) throw new Error('Invalid role');
      updated.role = role;
    }
    if (username) {
      if (users.find(u => u.username === username.trim() && u.id !== id)) throw new Error('Username already taken');
      updated.username = username.trim();
    }
    if (allowedApps !== undefined) updated.allowedApps = sanitizeAllowedApps(allowedApps);
    if (password) updated.passwordHash = await bcrypt.hash(password, 12);
    const newUsers = [...users];
    newUsers[i] = updated;
    save(newUsers);
    return { id: updated.id, username: updated.username, role: updated.role, allowedApps: updated.allowedApps || [], created_at: updated.createdAt };
  });
}

async function deleteUser(id) {
  return withLock('users', async () => {
    const users = load();
    const user = users.find(u => u.id === id);
    if (!user) throw new Error('User not found');
    if (user.role === 'admin' && users.filter(u => u.role === 'admin').length === 1) {
      throw new Error('Cannot delete the last admin account');
    }
    save(users.filter(u => u.id !== id));
  });
}

module.exports = { initUsers, findByUsername, findById, listUsers, createUser, updateUser, deleteUser, canAccessApp, ROLES };
