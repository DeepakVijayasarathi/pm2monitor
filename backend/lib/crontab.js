const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CRONTAB_BIN = process.env.CRONTAB_BIN || 'crontab';
const BACKUP_DIR = path.join(__dirname, '..', 'data', 'cron-backups');

function execCrontab(args) {
  return new Promise((resolve, reject) => {
    execFile(CRONTAB_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

// Raw text of a user's crontab, or '' if they have none yet
async function readCrontabRaw(user) {
  try {
    const { stdout } = await execCrontab(['-u', user, '-l']);
    return stdout;
  } catch (e) {
    const msg = `${e.stderr || ''} ${e.err?.message || ''}`.toLowerCase();
    if (msg.includes('no crontab for')) return '';
    throw new Error(e.stderr || e.err?.message || 'Failed to read crontab');
  }
}

// Parses crontab text into ordered lines, tagging real schedule entries vs comments/blanks
// so a rewrite can round-trip everything it doesn't touch byte-identical.
function parseCrontab(raw) {
  return raw.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === '')).map(line => {
    if (/^\s*$/.test(line)) return { type: 'blank', raw: line };
    if (/^\s*#/.test(line)) return { type: 'comment', raw: line };
    const m = line.match(/^\s*(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
    if (!m) return { type: 'comment', raw: line }; // unparseable line — preserve, don't expose for edit
    return { type: 'entry', schedule: m[1], command: m[2], raw: line };
  });
}

function serializeCrontab(lines) {
  const body = lines.map(l => l.type === 'entry' ? `${l.schedule} ${l.command}` : l.raw).join('\n');
  return body ? body + '\n' : '';
}

async function backupCrontab(user, raw) {
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.promises.writeFile(path.join(BACKUP_DIR, `${user}-${stamp}.txt`), raw, 'utf8');
  } catch {
    // best-effort — don't block the write on a backup failure
  }
}

function writeCrontabRaw(user, content) {
  return new Promise((resolve, reject) => {
    const child = spawn(CRONTAB_BIN, ['-u', user, '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `crontab exited with code ${code}`));
    });
    child.stdin.write(content);
    child.stdin.end();
  });
}

async function listEntries(user) {
  const raw = await readCrontabRaw(user);
  return parseCrontab(raw)
    .map((l, i) => ({ ...l, index: i }))
    .filter(l => l.type === 'entry');
}

function assertSingleLine(name, value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  if (/[\r\n]/.test(value)) throw new Error(`${name} cannot contain newlines`);
  return value.trim();
}

function assertSchedule(schedule) {
  const s = assertSingleLine('schedule', schedule);
  if (s.split(/\s+/).length !== 5) throw new Error('schedule must have exactly 5 fields (minute hour day month weekday)');
  return s;
}

async function addEntry(user, schedule, command) {
  const sched = assertSchedule(schedule);
  const cmd = assertSingleLine('command', command);
  const raw = await readCrontabRaw(user);
  const lines = parseCrontab(raw);
  lines.push({ type: 'entry', schedule: sched, command: cmd, raw: `${sched} ${cmd}` });
  await backupCrontab(user, raw);
  await writeCrontabRaw(user, serializeCrontab(lines));
}

async function updateEntry(user, index, schedule, command) {
  const sched = assertSchedule(schedule);
  const cmd = assertSingleLine('command', command);
  const raw = await readCrontabRaw(user);
  const lines = parseCrontab(raw);
  if (!lines[index] || lines[index].type !== 'entry') throw new Error('Cron entry not found');
  lines[index] = { type: 'entry', schedule: sched, command: cmd, raw: `${sched} ${cmd}` };
  await backupCrontab(user, raw);
  await writeCrontabRaw(user, serializeCrontab(lines));
}

async function deleteEntry(user, index) {
  const raw = await readCrontabRaw(user);
  const lines = parseCrontab(raw);
  if (!lines[index] || lines[index].type !== 'entry') throw new Error('Cron entry not found');
  lines.splice(index, 1);
  await backupCrontab(user, raw);
  await writeCrontabRaw(user, serializeCrontab(lines));
}

module.exports = { listEntries, addEntry, updateEntry, deleteEntry, parseCrontab, serializeCrontab };
