Auth.requireAuth();

const params = new URLSearchParams(location.search);
const APP_ID = params.get('id');
if (!APP_ID) { location.href = '/'; }

const user = Auth.getUser();
const isAdmin    = user?.role === 'admin';
const isOperator = user?.role === 'admin' || user?.role === 'operator';

/* ===== THEME ===== */
let cpuChart, memChart;
const applyTheme = t => {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  document.getElementById('themeToggle').querySelector('i').className =
    t === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
};
applyTheme(localStorage.getItem('theme') || 'dark');
document.getElementById('themeToggle').onclick = () =>
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

/* ===== USER MENU ===== */
if (user) {
  document.getElementById('uName').textContent = user.username;
  document.getElementById('uAvatar').textContent = user.username[0].toUpperCase();
  if (isAdmin) document.querySelectorAll('.admin-only').forEach(e => e.classList.remove('hidden'));
}
document.getElementById('userBtn').onclick = e => {
  e.stopPropagation();
  document.getElementById('userDrop').classList.toggle('hidden');
};
document.addEventListener('click', () => document.getElementById('userDrop').classList.add('hidden'));
document.getElementById('logoutBtn').onclick = () => Auth.logout();

/* ===== SIDEBAR ===== */
const sidebar  = document.getElementById('sidebar');
const sOverlay = document.getElementById('sOverlay');
document.getElementById('menuToggle').onclick = () => { sidebar.classList.add('open'); sOverlay.classList.add('open'); };
document.getElementById('sidebarClose').onclick = () => { sidebar.classList.remove('open'); sOverlay.classList.remove('open'); };
sOverlay.onclick = () => { sidebar.classList.remove('open'); sOverlay.classList.remove('open'); };

/* ===== TOAST ===== */
const toast = (msg, type = 'info') => {
  const icons = { success:'fa-circle-check', error:'fa-circle-xmark', warning:'fa-triangle-exclamation', info:'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i><span>${msg}</span>`;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 270); }, 3500);
};

const fmtBytes = b => { if (!b) return '0 B'; const u=['B','KB','MB','GB']; const i=Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(1)+' '+u[i]; };
const fmtUp = ms => { if (!ms) return '—'; const s=Math.floor((Date.now()-ms)/1000); if(s<60) return s+'s'; if(s<3600) return Math.floor(s/60)+'m '+s%60+'s'; if(s<86400) return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; return Math.floor(s/86400)+'d'; };
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const badge = st => { const m={online:'b-online',stopped:'b-stopped',errored:'b-errored',launching:'b-launching'}; return `<span class="badge ${m[st]||'b-default'}">${st||'—'}</span>`; };

/* ===== CHARTS ===== */
const cpuHist = Array(40).fill(0);
const memHist = Array(40).fill(0);

function mkChart(id, color, fill) {
  return new Chart(document.getElementById(id).getContext('2d'), {
    type: 'line',
    data: { labels: Array(40).fill(''), datasets: [{ data: Array(40).fill(0), borderColor: color, backgroundColor: fill, borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: true, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', callback: v => v + '%', maxTicksLimit: 4 }, border: { display: false } },
      },
    },
  });
}

function pushChart(chart, hist, val) {
  hist.push(val); hist.shift();
  chart.data.datasets[0].data = [...hist];
  chart.update('none');
}

/* ===== APP INFO ===== */
async function loadAppInfo() {
  try {
    const app = await Auth.apiFetch(`/apps/${APP_ID}`);
    document.getElementById('appName').textContent = app.name;
    document.getElementById('appBadge').innerHTML = badge(app.status);
    document.title = `${app.name} — PM2 Monitor`;

    document.getElementById('appInfo').innerHTML = [
      ['Status',     badge(app.status)],
      ['PID',        app.pid || '—'],
      ['Mode',       app.exec_mode || '—'],
      ['Instances',  app.instances ?? 1],
      ['Uptime',     fmtUp(app.uptime)],
      ['Restarts',   app.restarts ?? 0],
      ['CPU',        (app.cpu ?? 0) + '%'],
      ['Memory',     fmtBytes(app.memory)],
      ['Port',       app.port ? `:${app.port}` : '—'],
      ['Script',     `<span class="mono" style="font-size:0.75rem;word-break:break-all">${esc(app.script || '—')}</span>`],
      ['Working Dir',`<span class="mono" style="font-size:0.75rem;word-break:break-all">${esc(app.cwd || '—')}</span>`],
      ['Version',    app.version || '—'],
      ['Node',       app.node_version || '—'],
      ['Created',    app.created_at ? new Date(app.created_at).toLocaleString() : '—'],
    ].map(([k,v]) => `<div class="info-row"><span class="ir-key">${k}</span><span class="ir-val">${v}</span></div>`).join('');

    buildActionStrip(app);
  } catch (e) {
    document.getElementById('appName').textContent = 'Error';
    toast('Failed to load app details: ' + e.message, 'error');
  }
}

/* ===== ACTION STRIP ===== */
function buildActionStrip(app) {
  if (!isOperator) return;
  const strip = document.getElementById('actionStrip');
  strip.innerHTML = `
    <button class="act-btn ab-start"   id="actStart"  ><i class="fa-solid fa-play"></i> Start</button>
    <button class="act-btn ab-restart" id="actRestart"><i class="fa-solid fa-rotate-right"></i> Restart</button>
    <button class="act-btn ab-stop"    id="actStop"   ><i class="fa-solid fa-stop"></i> Stop</button>
    ${isAdmin ? `<button class="act-btn ab-del" id="actDelete"><i class="fa-solid fa-trash"></i> Delete</button>` : ''}
  `;

  const act = async (action, btn) => {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      if (action === 'delete') {
        await Auth.apiFetch(`/apps/${APP_ID}`, { method: 'DELETE' });
        toast('Application deleted', 'success');
        setTimeout(() => location.href = '/', 1200);
        return;
      }
      await Auth.apiFetch(`/apps/${APP_ID}/${action}`, { method: 'POST' });
      toast(`${action} successful`, 'success');
      setTimeout(loadAppInfo, 1000);
    } catch (e) {
      toast(`${action} failed: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  };

  document.getElementById('actStart')?.addEventListener('click', e => act('start', e.currentTarget));
  document.getElementById('actRestart')?.addEventListener('click', e => act('restart', e.currentTarget));
  document.getElementById('actStop')?.addEventListener('click', e => act('stop', e.currentTarget));
  document.getElementById('actDelete')?.addEventListener('click', e => {
    if (confirm(`Delete "${document.getElementById('appName').textContent}"? This cannot be undone.`)) act('delete', e.currentTarget);
  });
}

/* ===== LOGS ===== */
let currentTab = 'out';
let allLines = [];
let refreshTimer;
const logPre = document.getElementById('logPre');
const logSearch = document.getElementById('logSearch');

async function fetchLogs() {
  const lines = document.getElementById('linesSelect').value;
  try {
    const d = await Auth.apiFetch(`/apps/${APP_ID}/logs?lines=${lines}`);
    allLines = (currentTab === 'err' ? d.err : d.out) || [];
    renderLogs();
    document.getElementById('logStats').textContent =
      `${allLines.length} lines · ${currentTab === 'out' ? d.outPath : d.errPath || ''}`;
  } catch (e) {
    logPre.textContent = 'Error loading logs: ' + e.message;
  }
}

function renderLogs() {
  const q = logSearch.value.trim().toLowerCase();
  if (!q) {
    logPre.innerHTML = esc(allLines.join('\n'));
    document.getElementById('matchCount').classList.add('hidden');
  } else {
    let matches = 0;
    const html = allLines.map(line => {
      if (line.toLowerCase().includes(q)) {
        matches++;
        const safe = esc(line).replace(new RegExp(esc(q), 'gi'), m => `<mark class="log-mark">${m}</mark>`);
        return `<span class="log-hit">${safe}</span>`;
      }
      return `<span style="opacity:0.45">${esc(line)}</span>`;
    }).join('\n');
    logPre.innerHTML = html;
    const mc = document.getElementById('matchCount');
    mc.textContent = `${matches} match${matches !== 1 ? 'es' : ''}`;
    mc.classList.remove('hidden');
  }
  if (document.getElementById('autoScroll')?.checked) logPre.scrollTop = logPre.scrollHeight;
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  if (document.getElementById('autoRefresh').checked) {
    refreshTimer = setInterval(fetchLogs, 5000);
  }
}

document.getElementById('tabOut').onclick = () => {
  currentTab = 'out';
  document.getElementById('tabOut').classList.add('active');
  document.getElementById('tabErr').classList.remove('active');
  fetchLogs();
};
document.getElementById('tabErr').onclick = () => {
  currentTab = 'err';
  document.getElementById('tabErr').classList.add('active');
  document.getElementById('tabOut').classList.remove('active');
  fetchLogs();
};
document.getElementById('refreshLogs').onclick = fetchLogs;
document.getElementById('autoRefresh').onchange = startAutoRefresh;
document.getElementById('linesSelect').onchange = fetchLogs;
logSearch.addEventListener('input', renderLogs);

// Flush logs
if (isOperator) {
  document.querySelectorAll('.flush-only').forEach(e => e.classList.remove('hidden'));
  document.getElementById('flushLogs').onclick = async () => {
    if (!confirm('Flush all logs for this app?')) return;
    try {
      await Auth.apiFetch(`/apps/${APP_ID}/flush`, { method: 'POST' });
      allLines = [];
      logPre.textContent = '(logs flushed)';
      toast('Logs flushed', 'success');
    } catch (e) { toast('Flush failed: ' + e.message, 'error'); }
  };
}

// Download log
document.getElementById('downloadLogs').onclick = () => {
  const blob = new Blob([allLines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${APP_ID}-${currentTab}.log`;
  a.click();
};

/* ===== SOCKET — live metrics for this app ===== */
SocketManager.connect(Auth.getToken());
SocketManager.on('metrics', data => {
  const proc = (data.processes || []).find(p => String(p.id) === String(APP_ID));
  if (!proc) return;

  const cpu = proc.cpu ?? 0;
  const mem = proc.memory ?? 0;
  document.getElementById('liveCpu').textContent = cpu + '%';
  document.getElementById('liveMem').textContent = fmtBytes(mem);
  pushChart(cpuChart, cpuHist, cpu);

  const memPct = data.memory?.total ? Math.round(mem / data.memory.total * 1000) / 10 : 0;
  pushChart(memChart, memHist, Math.min(memPct, 100));
});

/* ===== BOOT ===== */
cpuChart = mkChart('cpuChart', '#6366f1', 'rgba(99,102,241,0.12)');
memChart = mkChart('memChart', '#22c55e', 'rgba(34,197,94,0.1)');

loadAppInfo();
fetchLogs();
startAutoRefresh();
// Refresh app info every 10s
setInterval(loadAppInfo, 10000);
