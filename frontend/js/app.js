/* ===== INIT ===== */
Auth.requireAuth();

// Theme
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

/* ===== STATE ===== */
const state = {
  apps: [],
  filteredApps: [],
  currentSection: 'dashboard',
  logsAppId: null,
  logsTab: 'out',
  cpuHistory: Array(30).fill(0),
  memHistory: Array(30).fill(0),
  duplicatePorts: {},
};

/* ===== UTILS ===== */
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(ms) {
  if (!ms) return '—';
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

function statusBadge(status) {
  const map = {
    online: 'badge-online',
    stopped: 'badge-stopped',
    stopping: 'badge-stopped',
    errored: 'badge-errored',
    launching: 'badge-launching',
  };
  const cls = map[status] || 'badge-default';
  return `<span class="badge ${cls}">${status || '—'}</span>`;
}

function toast(msg, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 350);
  }, 3500);
}

/* ===== NAVIGATION ===== */
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.section');
const pageTitle = document.getElementById('pageTitle');

const sectionTitles = { dashboard: 'Dashboard', applications: 'Applications', system: 'System', ports: 'Port Monitor' };

function showSection(name) {
  state.currentSection = name;
  sections.forEach(s => s.classList.toggle('active', s.id === `section-${name}`));
  navItems.forEach(n => n.classList.toggle('active', n.dataset.section === name));
  pageTitle.textContent = sectionTitles[name] || name;
  if (name === 'applications') renderAppsTable();
  if (name === 'system') loadSystemStats();
  if (name === 'ports') renderPortMap();
}

navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    showSection(item.dataset.section);
    closeSidebar();
  });
});

/* ===== SIDEBAR TOGGLE ===== */
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('open');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('open');
}

document.getElementById('menuToggle').addEventListener('click', openSidebar);
document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

/* ===== THEME ===== */
const themeToggle = document.getElementById('themeToggle');
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  themeToggle.querySelector('i').className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  updateChartTheme();
}
themeToggle.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});
applyTheme(savedTheme);

/* ===== USER MENU ===== */
const userBtn = document.getElementById('userBtn');
const userDropdown = document.getElementById('userDropdown');
const usernameDisplay = document.getElementById('usernameDisplay');
const user = Auth.getUser();
if (user) usernameDisplay.textContent = user.username;

userBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown.classList.toggle('hidden');
});
document.addEventListener('click', () => userDropdown.classList.add('hidden'));
document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

/* ===== CHARTS ===== */
let cpuChart, memChart;

function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: isDark ? 'rgba(48,54,61,0.8)' : 'rgba(209,217,228,0.5)',
    text: isDark ? '#8b949e' : '#57606a',
    cpu: isDark ? '#58a6ff' : '#0969da',
    mem: isDark ? '#3fb950' : '#1a7f37',
  };
}

function buildChart(id, color, label) {
  const ctx = document.getElementById(id).getContext('2d');
  const c = getChartColors();
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(30).fill(''),
      datasets: [{
        label,
        data: Array(30).fill(0),
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          min: 0, max: 100,
          grid: { color: c.grid },
          ticks: { color: c.text, callback: v => v + '%', maxTicksLimit: 5 },
        },
      },
    },
  });
}

function updateChartTheme() {
  const c = getChartColors();
  [cpuChart, memChart].forEach(chart => {
    if (!chart) return;
    chart.options.scales.y.grid.color = c.grid;
    chart.options.scales.y.ticks.color = c.text;
    chart.update('none');
  });
}

function initCharts() {
  const c = getChartColors();
  cpuChart = buildChart('cpuChart', c.cpu, 'CPU %');
  memChart = buildChart('memChart', c.mem, 'RAM %');
}

function pushChartData(chart, history, value) {
  history.push(value);
  history.shift();
  chart.data.datasets[0].data = [...history];
  chart.update('none');
}

/* ===== METRICS FROM SOCKET ===== */
function onMetrics(data) {
  // Summary cards (from process list)
  if (data.processes) {
    state.apps = data.processes;
    applyFilters();
    updateSummaryCards(data.processes);
    if (state.currentSection === 'applications') renderAppsTable();
    if (state.currentSection === 'ports') renderPortMap();
  }

  // CPU
  const cpuLoad = data.cpu?.load ?? 0;
  document.getElementById('cpuValue').textContent = cpuLoad + '%';
  document.getElementById('cpuBar').style.width = cpuLoad + '%';
  document.getElementById('cpuSub').textContent = `${data.cpu?.cores ?? '?'} cores`;
  pushChartData(cpuChart, state.cpuHistory, cpuLoad);

  // RAM
  const ramPct = data.memory?.percent ?? 0;
  document.getElementById('ramValue').textContent = ramPct + '%';
  document.getElementById('ramBar').style.width = ramPct + '%';
  document.getElementById('ramSub').textContent = `${formatBytes(data.memory?.used)} / ${formatBytes(data.memory?.total)}`;
  pushChartData(memChart, state.memHistory, ramPct);

  // Disk (first entry)
  const disk = (data.disk || [])[0];
  if (disk) {
    const diskPct = disk.use ?? 0;
    document.getElementById('diskValue').textContent = diskPct + '%';
    document.getElementById('diskBar').style.width = diskPct + '%';
    document.getElementById('diskSub').textContent = `${formatBytes(disk.used)} / ${formatBytes(disk.size)} (${disk.mount})`;
  }
}

function updateSummaryCards(apps) {
  document.getElementById('statTotal').textContent = apps.length;
  document.getElementById('statOnline').textContent = apps.filter(a => a.status === 'online').length;
  document.getElementById('statStopped').textContent = apps.filter(a => a.status === 'stopped').length;
  document.getElementById('statErrored').textContent = apps.filter(a => a.status === 'errored').length;
}

/* ===== FILTERS & SEARCH ===== */
const globalSearch = document.getElementById('globalSearch');
const statusFilter = document.getElementById('statusFilter');
const modeFilter = document.getElementById('modeFilter');

function applyFilters() {
  const q = (globalSearch?.value || '').toLowerCase();
  const st = statusFilter?.value || '';
  const md = modeFilter?.value || '';

  state.filteredApps = state.apps.filter(app => {
    if (q && !app.name?.toLowerCase().includes(q)) return false;
    if (st && app.status !== st) return false;
    if (md && app.exec_mode !== md) return false;
    return true;
  });
}

globalSearch?.addEventListener('input', () => { applyFilters(); renderAppsTable(); });
statusFilter?.addEventListener('change', () => { applyFilters(); renderAppsTable(); });
modeFilter?.addEventListener('change', () => { applyFilters(); renderAppsTable(); });

/* ===== APPS TABLE ===== */
function renderAppsTable() {
  const tbody = document.getElementById('appsTableBody');
  if (!tbody) return;

  if (state.filteredApps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="table-loading">${state.apps.length === 0 ? '<i class="fa-solid fa-spinner fa-spin"></i> Loading…' : 'No applications match your filters.'}</td></tr>`;

    // Dashboard version
    const dashTable = document.getElementById('dashboardAppsTable');
    if (dashTable) dashTable.innerHTML = `<p style="padding:20px;color:var(--text-secondary);text-align:center;">No applications found.</p>`;
    return;
  }

  const rows = state.filteredApps.map(app => `
    <tr data-id="${app.id}">
      <td style="color:var(--text-muted)">${app.id}</td>
      <td><strong>${escHtml(app.name)}</strong></td>
      <td>${statusBadge(app.status)}</td>
      <td>${app.cpu ?? 0}%</td>
      <td>${formatBytes(app.memory)}</td>
      <td>${app.restarts ?? 0}</td>
      <td>${formatUptime(app.uptime)}</td>
      <td>${app.port ? `<code style="font-size:0.8rem;">${app.port}</code>` : '—'}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon btn-success" title="Start" data-action="start" data-id="${app.id}"><i class="fa-solid fa-play"></i></button>
          <button class="btn-icon btn-warning" title="Restart" data-action="restart" data-id="${app.id}"><i class="fa-solid fa-rotate-right"></i></button>
          <button class="btn-icon btn-warning" title="Stop" data-action="stop" data-id="${app.id}"><i class="fa-solid fa-stop"></i></button>
          <button class="btn-icon btn-info" title="Logs" data-action="logs" data-id="${app.id}" data-name="${escHtml(app.name)}"><i class="fa-solid fa-terminal"></i></button>
          <button class="btn-icon btn-danger" title="Delete" data-action="delete" data-id="${app.id}" data-name="${escHtml(app.name)}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.innerHTML = rows;

  // Dashboard quick table
  const dashTable = document.getElementById('dashboardAppsTable');
  if (dashTable) {
    dashTable.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Name</th><th>Status</th><th>CPU</th><th>Memory</th><th>Restarts</th><th>Uptime</th></tr></thead>
        <tbody>
          ${state.filteredApps.map(app => `
            <tr>
              <td><strong>${escHtml(app.name)}</strong></td>
              <td>${statusBadge(app.status)}</td>
              <td>${app.cpu ?? 0}%</td>
              <td>${formatBytes(app.memory)}</td>
              <td>${app.restarts ?? 0}</td>
              <td>${formatUptime(app.uptime)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Duplicate port warning
  checkDuplicatePorts();
}

function checkDuplicatePorts() {
  const portMap = {};
  state.apps.forEach(app => {
    if (app.port) {
      const p = String(app.port);
      if (!portMap[p]) portMap[p] = [];
      portMap[p].push(app.name);
    }
  });

  const dups = Object.entries(portMap).filter(([, names]) => names.length > 1);
  const alert = document.getElementById('duplicatePortAlert');
  const msg = document.getElementById('duplicatePortMsg');

  if (alert && dups.length > 0) {
    msg.textContent = `Duplicate ports detected: ${dups.map(([p, names]) => `port ${p} (${names.join(', ')})`).join('; ')}`;
    alert.classList.remove('hidden');
  } else if (alert) {
    alert.classList.add('hidden');
  }
}

/* ===== TABLE ACTION DELEGATION ===== */
document.getElementById('appsTableBody')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  handleAppAction(btn.dataset.action, btn.dataset.id, btn.dataset.name);
});

async function handleAppAction(action, id, name) {
  if (action === 'logs') { openLogsModal(id, name); return; }

  if (action === 'delete') {
    if (!confirm(`Delete application "${name}" (ID ${id})? This cannot be undone.`)) return;
  }

  const endpoint = action === 'delete' ? `/apps/${id}` : `/apps/${id}/${action}`;
  const method = action === 'delete' ? 'DELETE' : 'POST';

  try {
    await Auth.apiFetch(endpoint, { method });
    toast(`${name}: ${action} successful`, 'success');
  } catch (err) {
    toast(`Failed to ${action} ${name}: ${err.message}`, 'error');
  }
}

/* ===== RESTART ALL ===== */
document.getElementById('restartAllBtn')?.addEventListener('click', async () => {
  if (!confirm('Restart all applications?')) return;
  try {
    await Auth.apiFetch('/apps/restart-all', { method: 'POST' });
    toast('All applications restarted', 'success');
  } catch (err) {
    toast('Failed to restart all: ' + err.message, 'error');
  }
});

document.getElementById('refreshAppsBtn')?.addEventListener('click', async () => {
  await loadApps();
  toast('Applications refreshed', 'info');
});

document.getElementById('refreshBtn')?.addEventListener('click', async () => {
  await loadApps();
  await loadSystemStats();
  toast('Data refreshed', 'info');
});

/* ===== LOAD APPS ===== */
async function loadApps() {
  try {
    const data = await Auth.apiFetch('/apps');
    state.apps = data.apps || [];
    applyFilters();
    updateSummaryCards(state.apps);
    renderAppsTable();
    if (state.currentSection === 'ports') renderPortMap();
  } catch (err) {
    toast('Failed to load applications: ' + err.message, 'error');
  }
}

/* ===== SYSTEM STATS ===== */
async function loadSystemStats() {
  try {
    const data = await Auth.apiFetch('/system/stats');

    // CPU details
    const cpuEl = document.getElementById('cpuDetails');
    if (cpuEl) cpuEl.innerHTML = infoRows([
      ['Brand', data.cpu.brand],
      ['Cores', `${data.cpu.physicalCores} physical / ${data.cpu.cores} logical`],
      ['Speed', `${data.cpu.speed} GHz`],
      ['Current Load', `${data.cpu.load}%`],
      ['Idle', `${data.cpu.idle}%`],
    ]);

    // Memory details
    const memEl = document.getElementById('memDetails');
    if (memEl) memEl.innerHTML = infoRows([
      ['Total', formatBytes(data.memory.total)],
      ['Used', formatBytes(data.memory.used)],
      ['Free', formatBytes(data.memory.free)],
      ['Usage', `${data.memory.percent}%`],
      ['Swap Total', formatBytes(data.memory.swapTotal)],
      ['Swap Used', formatBytes(data.memory.swapUsed)],
    ]);

    // OS info
    const osEl = document.getElementById('osDetails');
    if (osEl) osEl.innerHTML = infoRows([
      ['Platform', data.os.platform],
      ['Distro', data.os.distro],
      ['Release', data.os.release],
      ['Hostname', data.os.hostname],
      ['Arch', data.os.arch],
      ['Uptime', formatUptime(Date.now() - (data.os.uptime || 0) * 1000)],
    ]);

    // Disk details
    const diskEl = document.getElementById('diskDetails');
    if (diskEl) diskEl.innerHTML = data.disk.map(d => `
      <div style="margin-bottom:12px;">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px;color:var(--text-secondary)">${d.fs} (${d.mount})</div>
        <div class="disk-bar-wrap">
          <div class="progress-bar" style="flex:1;height:6px;">
            <div class="progress-fill" style="width:${d.use}%;background:var(--warning)"></div>
          </div>
          <span class="disk-bar-pct">${d.use}%</span>
        </div>
        <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">${formatBytes(d.used)} / ${formatBytes(d.size)}</div>
      </div>
    `).join('');

    // Per-core
    const coreEl = document.getElementById('perCoreContainer');
    if (coreEl && data.cpu.perCore.length > 0) {
      coreEl.innerHTML = data.cpu.perCore.map((pct, i) => `
        <div class="core-item">
          <div class="core-label">Core ${i}</div>
          <div class="core-bar">
            <div class="core-fill" style="height:${pct}%"></div>
          </div>
          <div class="core-pct">${pct}%</div>
        </div>
      `).join('');
    }
  } catch (err) {
    toast('Failed to load system stats: ' + err.message, 'error');
  }
}

function infoRows(pairs) {
  return pairs.map(([k, v]) => `
    <div class="info-row">
      <span class="info-key">${k}</span>
      <span class="info-val">${v ?? '—'}</span>
    </div>
  `).join('');
}

/* ===== PORT MAP ===== */
function renderPortMap() {
  const el = document.getElementById('appPortMap');
  if (!el) return;
  const withPorts = state.apps.filter(a => a.port);
  if (withPorts.length === 0) { el.innerHTML = '<p style="color:var(--text-secondary)">No port information available.</p>'; return; }
  el.innerHTML = withPorts.map(a => `
    <div class="info-row">
      <span class="info-key">${escHtml(a.name)}</span>
      <span class="info-val"><code style="font-size:0.85rem">:${a.port}</code> ${statusBadge(a.status)}</span>
    </div>
  `).join('');
}

/* ===== PORT CHECKER ===== */
document.getElementById('checkPortsBtn')?.addEventListener('click', async () => {
  const input = document.getElementById('portInput')?.value?.trim();
  if (!input) { toast('Enter port numbers to check', 'warning'); return; }
  try {
    const data = await Auth.apiFetch(`/system/ports?ports=${encodeURIComponent(input)}`);
    const el = document.getElementById('portResults');
    if (el) {
      el.innerHTML = data.ports.map(p =>
        p.inUse
          ? `<span class="port-tag port-used"><i class="fa-solid fa-circle-xmark"></i> :${p.port} In Use</span>`
          : `<span class="port-tag port-open"><i class="fa-solid fa-circle-check"></i> :${p.port} Free</span>`
      ).join('');
    }
  } catch (err) {
    toast('Port check failed: ' + err.message, 'error');
  }
});

/* ===== LOGS MODAL ===== */
const logsModal = document.getElementById('logsModalOverlay');
const logOutput = document.getElementById('logOutput');
const logsModalTitle = document.getElementById('logsModalTitle');
const logsAppName = document.getElementById('logsAppName');
const autoScrollCheck = document.getElementById('autoScrollCheck');

function openLogsModal(id, name) {
  state.logsAppId = id;
  state.logsTab = 'out';
  logsModalTitle.innerHTML = `<i class="fa-solid fa-terminal"></i> Logs — ${escHtml(name)}`;
  logsAppName.textContent = name;
  logsModal.classList.remove('hidden');
  document.getElementById('logsTabOut').classList.remove('btn-ghost');
  document.getElementById('logsTabErr').classList.add('btn-ghost');
  fetchLogs(id, 'out');
}

document.getElementById('logsModalClose')?.addEventListener('click', closeLogsModal);
logsModal?.addEventListener('click', (e) => { if (e.target === logsModal) closeLogsModal(); });

function closeLogsModal() {
  logsModal.classList.add('hidden');
  state.logsAppId = null;
  logOutput.textContent = '';
}

document.getElementById('logsTabOut')?.addEventListener('click', () => {
  state.logsTab = 'out';
  document.getElementById('logsTabOut').classList.remove('btn-ghost');
  document.getElementById('logsTabErr').classList.add('btn-ghost');
  if (state.logsAppId) fetchLogs(state.logsAppId, 'out');
});

document.getElementById('logsTabErr')?.addEventListener('click', () => {
  state.logsTab = 'err';
  document.getElementById('logsTabErr').classList.remove('btn-ghost');
  document.getElementById('logsTabOut').classList.add('btn-ghost');
  if (state.logsAppId) fetchLogs(state.logsAppId, 'err');
});

document.getElementById('flushLogsBtn')?.addEventListener('click', async () => {
  if (!state.logsAppId) return;
  if (!confirm('Flush logs for this application?')) return;
  try {
    await Auth.apiFetch(`/apps/${state.logsAppId}/flush`, { method: 'POST' });
    logOutput.textContent = '';
    toast('Logs flushed', 'success');
  } catch (err) {
    toast('Flush failed: ' + err.message, 'error');
  }
});

async function fetchLogs(id, tab) {
  logOutput.textContent = 'Loading logs…';
  try {
    const data = await Auth.apiFetch(`/apps/${id}/logs?lines=200`);
    const lines = (tab === 'err' ? data.err : data.out) || [];
    logOutput.textContent = lines.length > 0 ? lines.join('\n') : '(no log entries)';
    if (autoScrollCheck?.checked) logOutput.scrollTop = logOutput.scrollHeight;
  } catch (err) {
    logOutput.textContent = `Error loading logs: ${err.message}`;
  }
}

/* ===== XSS SANITIZE ===== */
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ===== SOCKET CONNECT ===== */
const socket = SocketManager.connect(Auth.getToken());
SocketManager.on('metrics', onMetrics);

/* ===== BOOT ===== */
(async function init() {
  initCharts();
  await loadApps();
  await loadSystemStats();
})();

// Keyboard shortcut: Escape closes modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLogsModal();
});
