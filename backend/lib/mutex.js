// Simple in-process async mutex, keyed by resource name. Serializes read-modify-write
// sequences (e.g. load-JSON -> mutate -> save-JSON) that would otherwise interleave
// across concurrent requests within this one Node process and lose updates.
const chains = new Map();

function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  // Swallow rejections in the chain itself so one failed call doesn't wedge the queue
  // for subsequent callers — each caller still gets their own real result/rejection via `run`.
  chains.set(key, run.then(() => {}, () => {}));
  return run;
}

module.exports = { withLock };
