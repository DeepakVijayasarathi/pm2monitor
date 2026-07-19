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
          ${isOperator ? `<button class="btn btn-ghost btn-sm" onclick="openUploadModal('${esc(s.id)}','${esc(s.name)}')">
            <i class="fa-solid fa-upload"></i> Deploy
          </button>` : ''}
          ${isOperator && s.type === 'nodejs' ? `<button class="btn btn-ghost btn-sm" onclick="restartSite(${s.pm2Id}, this)">
            <i class="fa-solid fa-rotate-right"></i> Restart
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

/* ===== BOOT ===== */
loadSites();
