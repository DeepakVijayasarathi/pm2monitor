const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, getAdminUser, authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const admin = await getAdminUser();

    if (String(username).trim() !== admin.username) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(String(password), admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken({ username: admin.username, role: 'admin' });
    res.json({ token, user: { username: admin.username, role: 'admin' } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', authenticateToken, (req, res) => {
  res.json({ message: 'Logged out' });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: { username: req.user.username, role: req.user.role } });
});

module.exports = router;
