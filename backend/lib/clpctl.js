const { execFile } = require('child_process');
const crypto = require('crypto');

const CLPCTL_BIN = process.env.CLPCTL_BIN || 'clpctl';

// Runs clpctl with an argv array — never a shell string — so nothing in `args`
// can be interpreted as shell syntax. Rejects on non-zero exit.
function runClpctl(args) {
  return new Promise((resolve, reject) => {
    execFile(CLPCTL_BIN, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = [stdout, stderr, err.message].filter(Boolean).join('\n').trim();
        return reject(new Error(detail || `clpctl exited with an error`));
      }
      resolve({ stdout, stderr });
    });
  });
}

function randomPassword(len = 24) {
  return crypto.randomBytes(len * 2)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, len);
}

// Guards against flag injection: a value that starts with "-" would be parsed
// by clpctl's own arg parser as a flag instead of the value we intended.
function assertSafeArgValue(name, value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`${name} is required`);
  }
  const s = String(value);
  if (s.startsWith('-')) throw new Error(`${name} cannot start with "-"`);
  if (/[\r\n]/.test(s)) throw new Error(`${name} cannot contain newlines`);
  return s;
}

function isValidDomain(domain) {
  if (typeof domain !== 'string' || domain.length < 3 || domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(label =>
    label.length >= 1 && label.length <= 63 &&
    /^[A-Za-z0-9-]+$/.test(label) &&
    !label.startsWith('-') && !label.endsWith('-'));
}

// Slugifies a domain into a valid, short Linux username
function deriveSiteUser(domain) {
  let slug = String(domain).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^[a-z]/.test(slug)) slug = 's' + slug;
  return slug.slice(0, 32) || 'site' + Date.now().toString(36);
}

module.exports = { runClpctl, randomPassword, assertSafeArgValue, isValidDomain, deriveSiteUser };
