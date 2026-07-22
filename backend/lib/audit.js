const fs = require('fs');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '..', 'data', 'audit.log');

// Append-only, best-effort audit trail for security-sensitive actions (user management,
// site create/delete, SSL issuance, cron changes, destructive file ops). A logging
// failure must never break the actual request, so this never throws.
function log(user, action, target, detail) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      userId: user?.id,
      username: user?.username,
      action,
      target,
      ...(detail !== undefined ? { detail } : {}),
    };
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // best-effort — logging must never break the request it's logging
  }
}

module.exports = { log };
