const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const xss = require('xss');
const { signToken, getAdminUser, authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required').isLength({ max: 64 }),
    body('password').notEmpty().withMessage('Password is required').isLength({ max: 128 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const username = xss(req.body.username.trim());
    const password = req.body.password;

    const admin = await getAdminUser();

    if (username !== admin.username) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken({ username: admin.username, role: 'admin' });

    res.json({
      token,
      user: { username: admin.username, role: 'admin' },
      expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    });
  }
);

router.post('/logout', authenticateToken, (req, res) => {
  // JWT is stateless; client discards the token
  res.json({ message: 'Logged out successfully' });
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: { username: req.user.username, role: req.user.role } });
});

module.exports = router;
