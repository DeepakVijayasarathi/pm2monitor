Auth.requireAuth();

/* ===== THEME ===== */
let cpuChart, memChart;

const applyTheme = t => {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  document.getElementById('themeToggle').querySelector('i').className =
    t === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  if (cpuChart) refreshChartColors();
};
applyTheme(localStorage.getItem('theme') || 'dark');

/* ===== STATE ===== */
const S = {
  apps: [], filtered: [],
  cpuHist: Array(30).fill(0), memHist: Array(30).fill(0),
  logsId: null, logsTab: 'out',
};

/* ===== UTILS ===== */
const fmtBytes = b => {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i];
};
const fmtUp = ms => {
  if (!ms) return '—';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
  return Math.floor(s/86400) + 'd';
};
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const badge = st => {
  const m = {online:'b-online',stopped:'b-stopped',errored:'b-errored',launching:'b-launching'};
  return `<span class="badge ${m[st]||'b-default'}">${st||'—'}</span>`;
};

/* ===== TOAST ===== */
const toast = (msg, type='info') => {
  const icons = {success:'fa-circle-check',error:'fa-circle-xmark',warning:'fa-triangle-exclamation',info:'fa-circle-info'};
  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i><span>${msg}</span>`;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 270); }, 3200);
};

/* ===== INLINE CONFIRM (no browser dialog) ===== */
function inlineConfirm(cell, label, onConfirm) {
  const orig = cell.innerHTML;
  cell.innerHTML = `
    <div class="confirm-row">
      <span class="confirm-msg">${label}?</span>
      <button class="confirm-yes"><i class="fa-solid fa-check"></i> Yes</button>
      <button class="confirm-no"><i class="fa-solid fa-xmark"></i> No</button>
    </div>`;
  const timer = setTimeout(() => { cell.innerHTML = orig; wireActions(); }, 4000);
  cell.querySelector('.confirm-yes').onclick = () => { clearTimeout(timer); onConfirm(); };
  cell.querySelector('.confirm-no').onclick = () => { clearTimeout(timer); cell.innerHTML = orig; wireActions(); };
}

/* ===== NAV ===== */
const titles = {dashboard:'Dashboard',applications:'Applications',system:'System',ports:'Port Monitor'};
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.toggle('active', s.id === `sec-${name}`));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === name));
  document.getElementById('pageTitle').textContent = titles[name];
  if (name === 'applications') renderAppsTable();
  if (name === 'system') loadSystem();
  if (name === 'ports') renderPortMap();
}
document.querySelectorAll('.nav-item').forEach(n =>
  n.addEventListener('click', e => { e.preventDefault(); showSection(n.dataset.section); closeSidebar(); })
);

/* ===== SIDEBAR ===== */
const sidebar = document.getElementById('sidebar');
const sOverlay = document.getElementById('sOverlay');
const openSidebar = () => { sidebar.classList.add('open'); sOverlay.classList.add('open'); };
const closeSidebar = () => { sidebar.classList.remove('open'); sOverlay.classList.remove('open'); };
document.getElementById('menuToggle').onclick = openSidebar;
document.getElementById('sidebarClose').onclick = closeSidebar;
sOverlay.onclick = closeSidebar;

/* ===== THEME TOGGLE ===== */
document.getElementById('themeToggle').onclick = () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

/* ===== USER MENU ===== */
const user = Auth.getUser();
const isAdmin    = user?.role === 'admin';
const isOperator = user?.role === 'admin' || user?.role === 'operator';
if (user) {
  document.getElementById('uName').textContent = user.username;
  document.getElementById('uAvatar').textContent = user.username[0].toUpperCase();
  if (isAdmin) document.querySelectorAll('.admin-only').forEach(e => e.classList.remove('hidden'));
  if (!isAdmin) {
    const rab = document.getElementById('restartAllBtn');
    if (rab) rab.classList.add('hidden');
    const fab = document.getElementById('fab');
    if (fab) fab.classList.add('hidden');
  }
}
document.getElementById('userBtn').onclick = e => {
  e.stopPropagation();
  document.getElementById('userDrop').classList.toggle('hidden');
};
document.addEventListener('click', () => document.getElementById('userDrop').classList.add('hidden'));
document.getElementById('logoutBtn').onclick = () => Auth.logout();

/* ===== CHARTS ===== */

function chartColors() {
  const d = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: d ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)',
    tick: d ? '#475569' : '#94a3b8',
  };
}

function buildChart(id, color, fill) {
  const c = chartColors();
  return new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: {
      labels: Array(30).fill(''),
      datasets: [{ data: Array(30).fill(0), borderColor: color, backgroundColor: fill,
        borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { min: 0, max: 100,
          grid: { color: c.grid },
          ticks: { color: c.tick, callback: v => v + '%', maxTicksLimit: 4 },
          border: { display: false },
        },
      },
    },
  });
}

function refreshChartColors() {
  const c = chartColors();
  [cpuChart, memChart].forEach(ch => {
    if (!ch) return;
    ch.options.scales.y.grid.color = c.grid;
    ch.options.scales.y.ticks.color = c.tick;
    ch.update('none');
  });
}

function initCharts() {
  cpuChart = buildChart('cpuChart', '#6366f1', 'rgba(99,102,241,0.12)');
  memChart = buildChart('memChart', '#22c55e', 'rgba(34,197,94,0.1)');
}

function pushChart(chart, hist, val) {
  hist.push(val); hist.shift();
  chart.data.datasets[0].data = [...hist];
  chart.update('none');
}

/* ===== METRICS ===== */
function onMetrics(data) {
  if (data.processes) {
    S.apps = data.processes;
    applyFilters();
    updateStats(data.processes);
    // Bug fix: dashboard table always updates; apps table only when that section is active
    renderDashTable(S.apps);
    if (document.getElementById('sec-applications').classList.contains('active')) renderAppsTable();
    if (document.getElementById('sec-ports').classList.contains('active')) renderPortMap();
  }

  const cpu = data.cpu?.load ?? 0;
  document.getElementById('mcCpu').textContent = cpu + '%';
  document.getElementById('mcCpu').className = 'mc-val' + (cpu > 85 ? ' danger' : cpu > 65 ? ' warn' : '');
  document.getElementById('pbCpu').style.width = cpu + '%';
  document.getElementById('mcCpuSub').textContent = `${data.cpu?.cores ?? '?'} cores`;
  document.getElementById('cbCpu').textContent = cpu + '%';
  pushChart(cpuChart, S.cpuHist, cpu);

  const ram = data.memory?.percent ?? 0;
  document.getElementById('mcRam').textContent = ram + '%';
  document.getElementById('mcRam').className = 'mc-val' + (ram > 85 ? ' danger' : ram > 65 ? ' warn' : '');
  document.getElementById('pbRam').style.width = ram + '%';
  document.getElementById('mcRamSub').textContent = `${fmtBytes(data.memory?.used)} / ${fmtBytes(data.memory?.total)}`;
  document.getElementById('cbMem').textContent = ram + '%';
  pushChart(memChart, S.memHist, ram);

  const disk = (data.disk || [])[0];
  if (disk) {
    const dp = disk.use ?? 0;
    document.getElementById('mcDisk').textContent = dp + '%';
    document.getElementById('mcDisk').className = 'mc-val' + (dp > 85 ? ' danger' : dp > 65 ? ' warn' : '');
    document.getElementById('pbDisk').style.width = dp + '%';
    document.getElementById('mcDiskSub').textContent = `${fmtBytes(disk.used)} / ${fmtBytes(disk.size)} (${disk.mount})`;
  }
}

function updateStats(apps) {
  document.getElementById('stTotal').textContent = apps.length;
  document.getElementById('stOnline').textContent = apps.filter(a => a.status === 'online').length;
  document.getElementById('stStopped').textContent = apps.filter(a => a.status === 'stopped').length;
  const errCount = apps.filter(a => a.status === 'errored').length;
  document.getElementById('stErrored').textContent = errCount;
  // Bug fix: renamed to avoid shadowing the outer badge() function
  const errBadgeEl = document.getElementById('errBadge');
  errBadgeEl.textContent = errCount;
  errBadgeEl.classList.toggle('hidden', errCount === 0);
}

/* ===== FILTERS ===== */
document.getElementById('gSearch').addEventListener('input', () => { applyFilters(); renderAppsTable(); });
document.getElementById('stFilter').addEventListener('change', () => { applyFilters(); renderAppsTable(); });
document.getElementById('modeFilter').addEventListener('change', () => { applyFilters(); renderAppsTable(); });

function applyFilters() {
  const q = document.getElementById('gSearch').value.toLowerCase();
  const st = document.getElementById('stFilter').value;
  const md = document.getElementById('modeFilter').value;
  S.filtered = S.apps.filter(a =>
    (!q || a.name?.toLowerCase().includes(q)) &&
    (!st || a.status === st) &&
    (!md || a.exec_mode === md)
  );
}

/* ===== APPS TABLE ===== */
function renderAppsTable() {
  const tbody = document.getElementById('appsTbody');
  if (!tbody) return;

  if (!S.filtered.length) {
    const msg = S.apps.length === 0 ? '<i class="fa-solid fa-spinner fa-spin"></i> Loading…' : 'No applications match your filters.';
    tbody.innerHTML = `<tr><td colspan="9" class="tl">${msg}</td></tr>`;
    // Bug fix: dashboard always shows all apps, not the filtered subset
    renderDashTable(S.apps);
    return;
  }

  tbody.innerHTML = S.filtered.map(a => `
    <tr>
      <td class="mono" style="color:var(--text-3)">${a.id}</td>
      <td>
        <a href="/app-detail.html?id=${a.id}" style="font-weight:600;color:var(--text);text-decoration:none;transition:color .18s"
           onmouseover="this.style.color='var(--indigo)'" onmouseout="this.style.color='var(--text)'">
          ${esc(a.name)}
        </a>
      </td>
      <td>${badge(a.status)}</td>
      <td>${a.cpu ?? 0}%</td>
      <td>${fmtBytes(a.memory)}</td>
      <td>${a.restarts ?? 0}</td>
      <td>${fmtUp(a.uptime)}</td>
      <td>${a.port ? `<span class="mono">:${a.port}</span>` : '—'}</td>
      <td>
        <div class="act-row" data-id="${a.id}" data-name="${esc(a.name)}">
          <a href="/app-detail.html?id=${a.id}" class="act-btn ab-log" title="Detail"><i class="fa-solid fa-chart-line"></i></a>
          ${isOperator ? `
          <button class="act-btn ab-start" data-action="start" title="Start"><i class="fa-solid fa-play"></i></button>
          <button class="act-btn ab-restart" data-action="restart" title="Restart"><i class="fa-solid fa-rotate-right"></i> Restart</button>
          <button class="act-btn ab-stop" data-action="stop" title="Stop"><i class="fa-solid fa-stop"></i></button>
          ` : ''}
          ${isAdmin ? `
          <button class="act-btn ab-del" data-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  wireActions();
  renderDashTable(S.apps);
  checkDupPorts();
}

function renderDashTable(apps) {
  const el = document.getElementById('dashTable');
  if (!el) return;
  if (!apps.length) { el.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-3)">No applications.</p>'; return; }
  el.innerHTML = `
    <table class="dtable">
      <thead><tr><th>Name</th><th>Status</th><th>CPU</th><th>Memory</th><th>Uptime</th><th>${isOperator ? 'Quick Action' : 'Detail'}</th></tr></thead>
      <tbody>
        ${apps.map(a => `
          <tr>
            <td>
              <a href="/app-detail.html?id=${a.id}" style="font-weight:600;color:var(--text);text-decoration:none"
                 onmouseover="this.style.color='var(--indigo)'" onmouseout="this.style.color='var(--text)'">
                ${esc(a.name)}
              </a>
            </td>
            <td>${badge(a.status)}</td>
            <td>${a.cpu ?? 0}%</td>
            <td>${fmtBytes(a.memory)}</td>
            <td>${fmtUp(a.uptime)}</td>
            <td>
              ${isOperator
                ? `<button class="restart-pill" data-id="${a.id}" data-name="${esc(a.name)}">
                    <i class="fa-solid fa-rotate-right"></i> Restart
                   </button>`
                : `<a href="/app-detail.html?id=${a.id}" class="act-btn ab-log" style="text-decoration:none"><i class="fa-solid fa-chart-line"></i> View</a>`
              }
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  // Wire restart pills — instant, no confirm
  el.querySelectorAll('.restart-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { id, name } = btn.dataset;
      btn.classList.add('spinning');
      btn.disabled = true;
      try {
        await Auth.apiFetch(`/apps/${id}/restart`, { method: 'POST' });
        toast(`${name} restarted`, 'success');
      } catch (e) {
        toast(`Restart failed: ${e.message}`, 'error');
      } finally {
        btn.classList.remove('spinning');
        btn.disabled = false;
      }
    });
  });
}

function wireActions() {
  document.querySelectorAll('#appsTbody .act-row').forEach(row => {
    row.querySelectorAll('[data-action]').forEach(btn => {
      btn.onclick = () => handleAction(btn.dataset.action, row.dataset.id, row.dataset.name, row);
    });
  });
}

async function handleAction(action, id, name, row) {
  if (action === 'logs') { openLogs(id, name); return; }

  if (action === 'restart') {
    // Instant restart — no confirm needed
    const btn = row.querySelector('[data-action="restart"]');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
      await Auth.apiFetch(`/apps/${id}/restart`, { method: 'POST' });
      toast(`${name} restarted`, 'success');
    } catch (e) {
      toast(`Failed: ${e.message}`, 'error');
    } finally {
      btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Restart';
      btn.disabled = false;
    }
    return;
  }

  if (action === 'delete') {
    const td = row.querySelector('[data-action="delete"]').parentElement;
    inlineConfirm(td, `Delete "${name}"`, async () => {
      try {
        await Auth.apiFetch(`/apps/${id}`, { method: 'DELETE' });
        toast(`${name} deleted`, 'success');
      } catch (e) { toast(`Failed: ${e.message}`, 'error'); }
    });
    return;
  }

  // start / stop
  const method = 'POST';
  const endpoint = `/apps/${id}/${action}`;
  try {
    await Auth.apiFetch(endpoint, { method });
    toast(`${name}: ${action} OK`, 'success');
  } catch (e) { toast(`Failed to ${action}: ${e.message}`, 'error'); }
}

function checkDupPorts() {
  const map = {};
  S.apps.forEach(a => { if (a.port) { const p = String(a.port); if (!map[p]) map[p]=[]; map[p].push(a.name); } });
  const dups = Object.entries(map).filter(([,v]) => v.length > 1);
  const el = document.getElementById('dupAlert');
  if (dups.length) {
    document.getElementById('dupMsg').textContent = 'Duplicate ports: ' + dups.map(([p,n]) => `${p} (${n.join(', ')})`).join('; ');
    el.classList.remove('hidden');
  } else el.classList.add('hidden');
}

/* ===== RESTART ALL ===== */
async function doRestartAll() {
  const fab = document.getElementById('fab');
  fab.classList.add('spinning'); fab.disabled = true;
  try {
    await Auth.apiFetch('/apps/restart-all', { method: 'POST' });
    toast('All applications restarted', 'success');
  } catch (e) { toast('Restart all failed: ' + e.message, 'error'); }
  finally { fab.classList.remove('spinning'); fab.disabled = false; }
}

document.getElementById('restartAllBtn').onclick = doRestartAll;
document.getElementById('fab').onclick = doRestartAll;
document.getElementById('refreshApps').onclick = async () => { await loadApps(); toast('Refreshed', 'info'); };
document.getElementById('refreshBtn').onclick = async () => { await loadApps(); await loadSystem(); toast('Refreshed', 'info'); };

/* ===== LOAD APPS ===== */
async function loadApps() {
  try {
    const d = await Auth.apiFetch('/apps');
    S.apps = d.apps || [];
    applyFilters();
    updateStats(S.apps);
    renderAppsTable();
    renderPortMap();
  } catch (e) { toast('Load failed: ' + e.message, 'error'); }
}

/* ===== SYSTEM ===== */
async function loadSystem() {
  try {
    const d = await Auth.apiFetch('/system/stats');
    const rows = (pairs) => pairs.map(([k,v]) =>
      `<div class="info-row"><span class="ir-key">${k}</span><span class="ir-val">${v ?? '—'}</span></div>`
    ).join('');

    document.getElementById('cpuInfo').innerHTML = rows([
      ['Brand', d.cpu.brand], ['Cores', `${d.cpu.physicalCores} physical / ${d.cpu.cores} logical`],
      ['Speed', d.cpu.speed + ' GHz'], ['Load', d.cpu.load + '%'], ['Idle', d.cpu.idle + '%'],
    ]);
    document.getElementById('memInfo').innerHTML = rows([
      ['Total', fmtBytes(d.memory.total)], ['Used', fmtBytes(d.memory.used)],
      ['Free', fmtBytes(d.memory.free)], ['Usage', d.memory.percent + '%'],
      ['Swap', `${fmtBytes(d.memory.swapUsed)} / ${fmtBytes(d.memory.swapTotal)}`],
    ]);
    document.getElementById('osInfo').innerHTML = rows([
      ['Platform', d.os.platform], ['Distro', d.os.distro],
      ['Release', d.os.release], ['Hostname', d.os.hostname], ['Arch', d.os.arch],
    ]);
    document.getElementById('diskInfo').innerHTML = d.disk.map(dk => `
      <div style="margin-bottom:12px">
        <div style="font-size:0.75rem;font-weight:600;color:var(--text-2);margin-bottom:6px">${dk.fs} → ${dk.mount}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="pbar" style="flex:1"><div class="pfill dsk" style="width:${dk.use}%"></div></div>
          <span style="font-size:0.75rem;font-weight:700;width:36px;text-align:right">${dk.use}%</span>
        </div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-top:4px">${fmtBytes(dk.used)} / ${fmtBytes(dk.size)}</div>
      </div>
    `).join('');

    const cg = document.getElementById('coreGrid');
    if (d.cpu.perCore?.length) {
      cg.innerHTML = d.cpu.perCore.map((p,i) => `
        <div class="core-box">
          <div class="core-lbl">Core ${i}</div>
          <div class="core-bar-wrap">
            <div class="core-fill" style="height:${p}%"></div>
          </div>
          <div class="core-pct">${p}%</div>
        </div>
      `).join('');
    }
  } catch (e) { toast('System stats error: ' + e.message, 'error'); }
}

/* ===== PORT MAP ===== */
function renderPortMap() {
  const el = document.getElementById('portMap');
  if (!el) return;
  const wp = S.apps.filter(a => a.port);
  el.innerHTML = wp.length
    ? wp.map(a => `<div class="info-row"><span class="ir-key">${esc(a.name)}</span><span class="ir-val"><span class="mono">:${a.port}</span> ${badge(a.status)}</span></div>`).join('')
    : '<p style="color:var(--text-3);font-size:0.83rem">No port data.</p>';
}

document.getElementById('checkPorts').onclick = async () => {
  const v = document.getElementById('portInput').value.trim();
  if (!v) return;
  try {
    const d = await Auth.apiFetch(`/system/ports?ports=${encodeURIComponent(v)}`);
    document.getElementById('portResults').innerHTML = d.ports.map(p =>
      `<span class="port-chip ${p.inUse ? 'pc-used' : 'pc-free'}">
        <i class="fa-solid ${p.inUse ? 'fa-circle-xmark' : 'fa-circle-check'}"></i> :${p.port} ${p.inUse ? 'In Use' : 'Free'}
      </span>`
    ).join('');
  } catch (e) { toast('Port check failed', 'error'); }
};

/* ===== LOGS ===== */
const logOv = document.getElementById('logOv');
const logPre = document.getElementById('logPre');

function openLogs(id, name) {
  S.logsId = id; S.logsTab = 'out';
  document.getElementById('logTitle').textContent = name;
  document.getElementById('logApp').textContent = name;
  document.getElementById('tabOut').classList.add('active');
  document.getElementById('tabErr').classList.remove('active');
  logOv.classList.remove('hidden');
  fetchLogs();
}

const closeLogs = () => { logOv.classList.add('hidden'); S.logsId = null; logPre.textContent = ''; };
document.getElementById('logClose').onclick = closeLogs;
logOv.addEventListener('click', e => { if (e.target === logOv) closeLogs(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLogs(); });

document.getElementById('tabOut').onclick = () => {
  S.logsTab = 'out';
  document.getElementById('tabOut').classList.add('active');
  document.getElementById('tabErr').classList.remove('active');
  fetchLogs();
};
document.getElementById('tabErr').onclick = () => {
  S.logsTab = 'err';
  document.getElementById('tabErr').classList.add('active');
  document.getElementById('tabOut').classList.remove('active');
  fetchLogs();
};
const flushBtn = document.getElementById('flushBtn');
if (!isOperator) flushBtn.classList.add('hidden');
flushBtn.onclick = async () => {
  if (!S.logsId) return;
  try { await Auth.apiFetch(`/apps/${S.logsId}/flush`, { method: 'POST' }); logPre.textContent = ''; toast('Flushed', 'success'); }
  catch (e) { toast('Flush failed', 'error'); }
};

async function fetchLogs() {
  logPre.textContent = 'Loading…';
  try {
    const d = await Auth.apiFetch(`/apps/${S.logsId}/logs?lines=200`);
    const lines = (S.logsTab === 'err' ? d.err : d.out) || [];
    logPre.textContent = lines.length ? lines.join('\n') : '(empty)';
    if (document.getElementById('autoScroll').checked) logPre.scrollTop = logPre.scrollHeight;
  } catch (e) { logPre.textContent = 'Error: ' + e.message; }
}

/* ===== SOCKET ===== */
SocketManager.connect(Auth.getToken());
SocketManager.on('metrics', onMetrics);

/* ===== BOOT ===== */
(async () => {
  initCharts();
  await loadApps();
  await loadSystem();
})();
