const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { listUsers, createUser, updateUser, deleteUser, findById, hasPermission } = require('../users');
const audit = require('../lib/audit');

const router = express.Router();

// GET /api/users — users.read
router.get('/', requirePermission('users', 'read'), (req, res) => {
  try {
    res.json({ users: listUsers() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — users.write
router.post('/', requirePermission('users', 'write'), async (req, res) => {
  try {
    const { username, password, permissions, allowedApps } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = await createUser(username, password, permissions, allowedApps);
    audit.log(req.user, 'user.create', user.username, { permissions: user.permissions });
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/users/:id — update permissions/username/allowedApps (users.write)
router.put('/:id', requirePermission('users', 'write'), async (req, res) => {
  try {
    const { permissions, username, allowedApps } = req.body || {};
    const user = await updateUser(req.params.id, { permissions, username, allowedApps });
    audit.log(req.user, 'user.update', user.username, { permissions, username, allowedApps });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/users/:id/password — users.write changes anyone; user changes own
router.put('/:id/password', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!hasPermission(req.user, 'users', 'write') && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const target = findById(req.params.id);
    await updateUser(req.params.id, { password });
    audit.log(req.user, 'user.password_change', target?.username || req.params.id);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/users/:id — users.delete, cannot delete self
router.delete('/:id', requirePermission('users', 'delete'), async (req, res) => {
  try {
    if (req.user.id === req.params.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const target = findById(req.params.id);
    await deleteUser(req.params.id);
    audit.log(req.user, 'user.delete', target?.username || req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
