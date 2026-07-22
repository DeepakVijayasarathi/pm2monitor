const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { findById } = require('../users');

// Secrets that have shipped as defaults in this project's Dockerfile/code history.
// Anyone who has ever read either file knows these values, so treat them as public.
const KNOWN_BAD_SECRETS = new Set(['change-this-secret', 'fallback-secret-change-in-production', 'changeme', 'secret']);

function resolveJwtSecret() {
  const configured = process.env.JWT_SECRET;
  if (configured && !KNOWN_BAD_SECRETS.has(configured)) return configured;

  const reason = configured
    ? 'JWT_SECRET is set to a known placeholder value that has shipped in this project\'s Dockerfile/source — anyone who has read either can forge admin tokens.'
    : 'JWT_SECRET is not set.';

  // eslint-disable-next-line no-console
  console.warn([
    '',
    '='.repeat(70),
    `WARNING: ${reason}`,
    'Generating a random secret for this process instead — existing',
    'sessions will not survive a restart. Set a real JWT_SECRET env var',
    'to fix this permanently.',
    '='.repeat(70),
    '',
  ].join('\n'));
  return crypto.randomBytes(48).toString('hex');
}

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

// Re-reads role/allowedApps from disk on every request so admin changes
// (role, allowed apps) take effect immediately instead of waiting for the
// user's existing JWT to expire and them to log back in.
function authenticateToken(req, res, next) {
  const header = req.headers['authorization'];
  const token = header && header.startsWith('Bearer ') && header.slice(7);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(403).json({ error: 'Invalid or expired token' });
  const live = findById(payload.id);
  if (!live) return res.status(403).json({ error: 'User no longer exists' });
  req.user = { id: live.id, username: live.username, role: live.role, allowedApps: live.allowedApps || [] };
  next();
}

// Middleware factory — usage: requireRole('admin') or requireRole('admin','operator')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

module.exports = { authenticateToken, verifyToken, signToken, requireRole };
