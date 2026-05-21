const express = require('express');
const { requireRole } = require('../middleware/auth');
const { listUsers, createUser, updateUser, deleteUser, ROLES } = require('../users');

const router = express.Router();

// GET /api/users — admin only
router.get('/', requireRole('admin'), (req, res) => {
  try {
    res.json({ users: listUsers() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users — admin only
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password and role are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = await createUser(username, password, role);
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/users/:id — update role or username (admin only)
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { role, username } = req.body || {};
    const user = await updateUser(req.params.id, { role, username });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/users/:id/password — admin changes anyone; user changes own
router.put('/:id/password', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    await updateUser(req.params.id, { password });
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/users/:id — admin only, cannot delete self
router.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    if (req.user.id === req.params.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    deleteUser(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/users/roles — return available roles
router.get('/roles', requireRole('admin'), (req, res) => {
  res.json({ roles: ROLES });
});

module.exports = router;
