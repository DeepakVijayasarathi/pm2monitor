const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// admin  : full access including user management
// operator: restart/stop/start/flush apps — no delete, no user management
// viewer  : read-only
const ROLES = ['admin', 'operator', 'viewer'];

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function save(users) {
  ensureDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
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
  return load().map(({ id, username, role, createdAt }) => ({ id, username, role, created_at: createdAt }));
}

async function createUser(username, password, role) {
  if (!ROLES.includes(role)) throw new Error('Invalid role');
  const users = load();
  if (users.find(u => u.username === username.trim())) throw new Error('Username already exists');
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    username: username.trim(),
    passwordHash: await bcrypt.hash(password, 12),
    role,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  save(users);
  return { id: user.id, username: user.username, role: user.role, created_at: user.createdAt };
}

async function updateUser(id, { username, role, password } = {}) {
  const users = load();
  const i = users.findIndex(u => u.id === id);
  if (i === -1) throw new Error('User not found');
  if (role) {
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    users[i].role = role;
  }
  if (username) {
    if (users.find(u => u.username === username.trim() && u.id !== id)) throw new Error('Username already taken');
    users[i].username = username.trim();
  }
  if (password) users[i].passwordHash = await bcrypt.hash(password, 12);
  save(users);
  return { id: users[i].id, username: users[i].username, role: users[i].role, created_at: users[i].createdAt };
}

function deleteUser(id) {
  const users = load();
  const user = users.find(u => u.id === id);
  if (!user) throw new Error('User not found');
  if (user.role === 'admin' && users.filter(u => u.role === 'admin').length === 1) {
    throw new Error('Cannot delete the last admin account');
  }
  save(users.filter(u => u.id !== id));
}

module.exports = { initUsers, findByUsername, findById, listUsers, createUser, updateUser, deleteUser, ROLES };
