Auth.requireAuth();

const me = Auth.getUser();
const isAdmin    = me?.role === 'admin';
const isOperator = me?.role === 'admin' || me?.role === 'operator';

/* ===== THEME ===== */
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
if (me) {
  document.getElementById('uName').textContent = me.username;
  document.getElementById('uAvatar').textContent = me.username[0].toUpperCase();
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
document.getElementById('menuToggle').onclick  = () => { sidebar.classList.add('open'); sOverlay.classList.add('open'); };
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

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const badge = st => {
  const m = { online:'b-online', stopped:'b-stopped', errored:'b-errored', launching:'b-launching' };
  return `<span class="badge ${m[st] || 'b-default'}">${st || '—'}</span>`;
};
const fmtDate = iso => iso ? new Date(iso).toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const fmtBytes = b => { if (!b) return '0 B'; const u = ['B','KB','MB','GB','TB']; const i = Math.floor(Math.log(b) / Math.log(1024)); return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i]; };

/* ===== LOAD SITES ===== */
let sites = [];

async function loadSites() {
  try {
    const data = await Auth.apiFetch('/sites');
    sites = data.sites || [];
    renderSites();
    document.getElementById('siteCount').textContent = sites.length;

    if (data.homeRoot) document.getElementById('rootPathLabel').textContent = `${data.homeRoot}/*/htdocs/*`;

    const warnEl = document.getElementById('sitesWarn');
    const warnings = data.warnings || [];
    if (warnings.length) {
      document.getElementById('sitesWarnMsg').textContent =
        `Couldn't read ${warnings.length} path${warnings.length === 1 ? '' : 's'}: ` +
        warnings.map(w => `${w.path} (${w.error})`).join('; ');
      warnEl.classList.remove('hidden');
    } else {
      warnEl.classList.add('hidden');
    }
  } catch (e) {
    document.getElementById('sitesTbody').innerHTML =
      `<tr><td colspan="7" class="tl" style="color:var(--red)"><i class="fa-solid fa-circle-xmark"></i> ${esc(e.message)}</td></tr>`;
  }
}

function typeBadge(type) {
  return type === 'nodejs'
    ? '<span class="badge b-online" style="background:var(--indigo-dim);color:var(--indigo)"><i class="fa-brands fa-node-js"></i> Node.js</span>'
    : '<span class="badge b-default">Static</span>';
}

function renderSites() {
  const tbody = document.getElementById('sitesTbody');
  if (!sites.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="tl">No applications found under the configured apps root.</td></tr>';
    return;
  }
  tbody.innerHTML = sites.map(s => `
    <tr>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${typeBadge(s.type)}</td>
      <td>${s.type === 'nodejs' ? badge(s.status) : '<span style="color:var(--muted)">—</span>'}</td>
      <td>${s.itemCount}</td>
      <td style="color:var(--muted);font-size:.8rem">${fmtDate(s.modified)}</td>
      <td style="color:var(--muted);font-size:.75rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.path)}">${esc(s.path)}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <a class="btn btn-ghost btn-sm" href="files.html?site=${encodeURIComponent(s.id)}&name=${encodeURIComponent(s.name)}">
            <i class="fa-solid fa-folder-open"></i> Browse
          </a>
          ${isOperator ? `<button class="btn btn-ghost btn-sm" onclick="openUploadModal('${esc(s.id)}','${esc(s.name)}')">
            <i class="fa-solid fa-upload"></i> Deploy
          </button>` : ''}
          ${isOperator && s.type === 'nodejs' ? `<button class="btn btn-ghost btn-sm" onclick="restartSite(${s.pm2Id}, this)">
            <i class="fa-solid fa-rotate-right"></i> Restart
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="openCronModal('${esc(s.id)}','${esc(s.name)}')">
            <i class="fa-solid fa-clock"></i> Cron
          </button>
          ${isAdmin ? `<button class="btn btn-ghost btn-sm" onclick="openSslModal('${esc(s.name)}')">
            <i class="fa-solid fa-lock"></i> SSL
          </button>
          <button class="btn btn-sm btn-danger" onclick="openDeleteSiteModal('${esc(s.name)}')">
            <i class="fa-solid fa-trash"></i> Delete
          </button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

async function restartSite(pm2Id, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await Auth.apiFetch(`/apps/${pm2Id}/restart`, { method: 'POST' });
    toast('Restarted', 'success');
    await loadSites();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

/* ===== UPLOAD MODAL ===== */
let uploadTargetId = null;

function openUploadModal(id, name) {
  uploadTargetId = id;
  document.getElementById('uploadTargetName').textContent = name;
  document.getElementById('uploadFile').value = '';
  document.getElementById('uploadErr').classList.add('hidden');
  document.getElementById('uploadErr').textContent = '';
  document.getElementById('uploadPbarWrap').classList.add('hidden');
  document.getElementById('uploadPbar').style.width = '0%';
  document.getElementById('uploadModal').classList.remove('hidden');
}

function closeUploadModal() {
  document.getElementById('uploadModal').classList.add('hidden');
  uploadTargetId = null;
}

document.getElementById('uploadModalClose').onclick = closeUploadModal;
document.getElementById('uploadCancel').onclick = closeUploadModal;
document.getElementById('uploadModal').addEventListener('click', e => {
  if (e.target === document.getElementById('uploadModal')) closeUploadModal();
});

function uploadZip(id, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sites/${id}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

document.getElementById('uploadSave').onclick = async () => {
  const fileInput = document.getElementById('uploadFile');
  const file = fileInput.files[0];
  const errEl = document.getElementById('uploadErr');
  errEl.classList.add('hidden');
  errEl.textContent = '';

  if (!file) { errEl.textContent = 'Choose a .zip file first'; errEl.classList.remove('hidden'); return; }
  if (!/\.zip$/i.test(file.name)) { errEl.textContent = 'Only .zip files are accepted'; errEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('uploadSave');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deploying…';
  document.getElementById('uploadPbarWrap').classList.remove('hidden');

  try {
    const res = await uploadZip(uploadTargetId, file, pct => {
      document.getElementById('uploadPbar').style.width = pct + '%';
    });
    toast(res.message || 'Deployed', 'success');
    closeUploadModal();
    await loadSites();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== REFRESH ===== */
document.getElementById('refreshSites').onclick = loadSites;

/* ===== NEW APPLICATION MODAL ===== */
const NS_FIELD_MAP = { nodejs: 'nsFieldsNodejs', php: 'nsFieldsPhp', python: 'nsFieldsPython', 'reverse-proxy': 'nsFieldsProxy', static: null };

function nsShowFieldsFor(type) {
  Object.values(NS_FIELD_MAP).forEach(id => { if (id) document.getElementById(id).style.display = 'none'; });
  const id = NS_FIELD_MAP[type];
  if (id) document.getElementById(id).style.display = 'flex';
}

document.getElementById('nsType').onchange = e => nsShowFieldsFor(e.target.value);

document.getElementById('newSiteBtn').onclick = () => {
  document.getElementById('nsDomain').value = '';
  document.getElementById('nsType').value = 'nodejs';
  document.getElementById('nsNodeVersion').value = '22';
  document.getElementById('nsNodePort').value = '';
  document.getElementById('nsPhpVersion').value = '8.3';
  document.getElementById('nsPhpTemplate').value = 'Generic';
  document.getElementById('nsPyVersion').value = '3.12';
  document.getElementById('nsPyPort').value = '';
  document.getElementById('nsProxyUrl').value = '';
  document.getElementById('nsSiteUser').value = '';
  document.getElementById('newSiteErr').classList.add('hidden');
  nsShowFieldsFor('nodejs');
  document.getElementById('newSiteForm').classList.remove('hidden');
  document.getElementById('newSiteResult').classList.add('hidden');
  document.getElementById('newSiteModal').classList.remove('hidden');
};

function closeNewSiteModal() { document.getElementById('newSiteModal').classList.add('hidden'); }
document.getElementById('newSiteModalClose').onclick = closeNewSiteModal;
document.getElementById('newSiteCancel').onclick = closeNewSiteModal;
document.getElementById('newSiteDone').onclick = () => { closeNewSiteModal(); loadSites(); };

document.getElementById('newSiteSave').onclick = async () => {
  const errEl = document.getElementById('newSiteErr');
  errEl.classList.add('hidden');

  const type = document.getElementById('nsType').value;
  const body = {
    domainName: document.getElementById('nsDomain').value.trim(),
    type,
    siteUser: document.getElementById('nsSiteUser').value.trim() || undefined,
  };
  if (type === 'nodejs') { body.nodejsVersion = document.getElementById('nsNodeVersion').value.trim(); body.appPort = document.getElementById('nsNodePort').value.trim(); }
  if (type === 'php') { body.phpVersion = document.getElementById('nsPhpVersion').value.trim(); body.vhostTemplate = document.getElementById('nsPhpTemplate').value.trim(); }
  if (type === 'python') { body.pythonVersion = document.getElementById('nsPyVersion').value.trim(); body.appPort = document.getElementById('nsPyPort').value.trim(); }
  if (type === 'reverse-proxy') { body.reverseProxyUrl = document.getElementById('nsProxyUrl').value.trim(); }

  const btn = document.getElementById('newSiteSave');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating…';

  try {
    const res = await Auth.apiFetch('/vhosts', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('nsResultUser').value = res.siteUser;
    document.getElementById('nsResultPassword').value = res.siteUserPassword;
    document.getElementById('nsResultOutput').textContent = res.output || '';
    document.getElementById('newSiteForm').classList.add('hidden');
    document.getElementById('newSiteResult').classList.remove('hidden');
    toast(res.message || 'Site created', 'success');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== SSL MODAL ===== */
let sslTargetDomain = null;

function openSslModal(domain) {
  sslTargetDomain = domain;
  document.getElementById('sslTargetName').textContent = domain;
  document.getElementById('sslSan').value = '';
  document.getElementById('sslErr').classList.add('hidden');
  document.getElementById('sslOutputWrap').classList.add('hidden');
  document.getElementById('sslModal').classList.remove('hidden');
}
function closeSslModal() { document.getElementById('sslModal').classList.add('hidden'); }
document.getElementById('sslModalClose').onclick = closeSslModal;
document.getElementById('sslCancel').onclick = closeSslModal;

document.getElementById('sslSave').onclick = async () => {
  const errEl = document.getElementById('sslErr');
  errEl.classList.add('hidden');
  const btn = document.getElementById('sslSave');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Issuing…';

  try {
    const san = document.getElementById('sslSan').value.trim();
    const res = await Auth.apiFetch('/vhosts/ssl', {
      method: 'POST',
      body: JSON.stringify({ domainName: sslTargetDomain, subjectAlternativeName: san || undefined }),
    });
    document.getElementById('sslOutput').textContent = res.output || '';
    document.getElementById('sslOutputWrap').classList.remove('hidden');
    toast(res.message || 'Certificate installed', 'success');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== DELETE SITE MODAL ===== */
let deleteSiteDomain = null;

function openDeleteSiteModal(domain) {
  deleteSiteDomain = domain;
  document.getElementById('delSiteName').textContent = domain;
  document.getElementById('delSiteConfirm').value = '';
  document.getElementById('deleteSiteConfirmBtn').disabled = true;
  document.getElementById('deleteSiteErr').classList.add('hidden');
  document.getElementById('deleteSiteModal').classList.remove('hidden');
}
function closeDeleteSiteModal() { document.getElementById('deleteSiteModal').classList.add('hidden'); }
document.getElementById('deleteSiteModalClose').onclick = closeDeleteSiteModal;
document.getElementById('deleteSiteCancel').onclick = closeDeleteSiteModal;
document.getElementById('delSiteConfirm').oninput = e => {
  document.getElementById('deleteSiteConfirmBtn').disabled = e.target.value.trim() !== deleteSiteDomain;
};
document.getElementById('deleteSiteConfirmBtn').onclick = async () => {
  const errEl = document.getElementById('deleteSiteErr');
  errEl.classList.add('hidden');
  const btn = document.getElementById('deleteSiteConfirmBtn');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting…';

  try {
    const res = await Auth.apiFetch(`/vhosts/${encodeURIComponent(deleteSiteDomain)}`, { method: 'DELETE' });
    toast(res.message || 'Site deleted', 'success');
    closeDeleteSiteModal();
    await loadSites();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== CRON MODAL ===== */
let cronTargetId = null;

function cronApiPath(suffix = '') {
  return `/sites/${encodeURIComponent(cronTargetId)}/cron${suffix}`;
}

async function openCronModal(id, name) {
  cronTargetId = id;
  document.getElementById('cronTargetName').textContent = name;
  document.getElementById('cronSchedule').value = '';
  document.getElementById('cronCommand').value = '';
  document.getElementById('cronErr').classList.add('hidden');
  document.getElementById('cronAddForm').classList.toggle('hidden', !isOperator);
  document.getElementById('cronModal').classList.remove('hidden');
  await loadCronEntries();
}
function closeCronModal() { document.getElementById('cronModal').classList.add('hidden'); cronTargetId = null; }
document.getElementById('cronModalClose').onclick = closeCronModal;

async function loadCronEntries() {
  const tbody = document.getElementById('cronTbody');
  tbody.innerHTML = '<tr><td colspan="3" class="tl"><i class="fa-solid fa-spinner fa-spin"></i></td></tr>';
  try {
    const data = await Auth.apiFetch(cronApiPath());
    const entries = data.entries || [];
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="tl">No cron jobs.</td></tr>';
      return;
    }
    tbody.innerHTML = entries.map(en => `
      <tr>
        <td class="mono">${esc(en.schedule)}</td>
        <td class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(en.command)}">${esc(en.command)}</td>
        <td>${isOperator ? `<button class="btn btn-sm btn-danger" onclick="deleteCronEntry(${en.index}, this)"><i class="fa-solid fa-trash"></i></button>` : ''}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="tl" style="color:var(--red)">${esc(e.message)}</td></tr>`;
  }
}

document.getElementById('cronAddBtn').onclick = async () => {
  const errEl = document.getElementById('cronErr');
  errEl.classList.add('hidden');
  const schedule = document.getElementById('cronSchedule').value.trim();
  const command = document.getElementById('cronCommand').value.trim();
  const btn = document.getElementById('cronAddBtn');
  btn.disabled = true;
  try {
    await Auth.apiFetch(cronApiPath(), { method: 'POST', body: JSON.stringify({ schedule, command }) });
    document.getElementById('cronSchedule').value = '';
    document.getElementById('cronCommand').value = '';
    toast('Cron job added', 'success');
    await loadCronEntries();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
};

async function deleteCronEntry(index, btn) {
  btn.disabled = true;
  try {
    await Auth.apiFetch(cronApiPath(`/${index}`), { method: 'DELETE' });
    toast('Cron job deleted', 'success');
    await loadCronEntries();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
  }
}

/* ===== BOOT ===== */
loadSites();
