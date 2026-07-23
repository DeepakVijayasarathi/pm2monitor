Auth.requireAuth();
Auth.requireAdmin();

const me = Auth.getUser();

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
document.getElementById('uName').textContent = me.username;
document.getElementById('uAvatar').textContent = me.username[0].toUpperCase();
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

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ROLE_ORDER = ['admin', 'operator', 'viewer'];

function roleBadge(role) {
  return `<span class="role-badge rb-${role}">${role}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
}

/* ===== LOAD APPS (for allowed-apps checklist) =====
   allowedApps is matched against two different names for the same nodejs app:
   the PM2 process's own name (Applications page) and the site's domain/folder
   name (All Applications page) — these are often NOT the same string, so the
   checklist must offer both, and static sites (no PM2 process at all) only
   ever have the site name. Merge both sources so nothing is unselectable. */
let appNames = [];

async function loadAppNames() {
  try {
    const [appsData, sitesData] = await Promise.all([
      Auth.apiFetch('/apps').catch(() => ({ apps: [] })),
      Auth.apiFetch('/sites').catch(() => ({ sites: [] })),
    ]);
    const names = new Set();
    (appsData.apps || []).forEach(a => names.add(a.name));
    (sitesData.sites || []).forEach(s => names.add(s.name));
    appNames = [...names].sort((a, b) => a.localeCompare(b));
  } catch (e) {
    appNames = [];
  }
}

function renderAppChecklist(selected) {
  const list = document.getElementById('mAppList');
  list.innerHTML = appNames.length
    ? appNames.map(name => `
        <label style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <input type="checkbox" class="mAppChk" value="${esc(name)}" ${selected.includes(name) ? 'checked' : ''}/> ${esc(name)}
        </label>
      `).join('')
    : '<div style="color:var(--muted);font-size:.8rem">No applications found.</div>';
}

function setAppsGroupMode(role, selected) {
  const allAppsChk = document.getElementById('mAllApps');
  const list = document.getElementById('mAppList');
  const group = document.getElementById('appsGroup');
  if (role === 'admin') {
    group.style.opacity = '.5';
    allAppsChk.checked = true;
    allAppsChk.disabled = true;
    list.style.display = 'none';
    return;
  }
  group.style.opacity = '1';
  allAppsChk.disabled = false;
  allAppsChk.checked = selected.length === 0;
  list.style.display = allAppsChk.checked ? 'none' : 'block';
}

document.getElementById('mAllApps').onchange = () => {
  document.getElementById('mAppList').style.display = document.getElementById('mAllApps').checked ? 'none' : 'block';
};

document.getElementById('mRole').addEventListener('change', () => {
  const selected = [...document.querySelectorAll('.mAppChk:checked')].map(c => c.value);
  setAppsGroupMode(document.getElementById('mRole').value, selected);
});

function getSelectedApps() {
  if (document.getElementById('mAllApps').checked) return [];
  return [...document.querySelectorAll('.mAppChk:checked')].map(c => c.value);
}

function appsSummary(u) {
  if (u.role === 'admin' || !u.allowedApps || !u.allowedApps.length) return '<span style="color:var(--muted)">All</span>';
  return `${u.allowedApps.length} app${u.allowedApps.length === 1 ? '' : 's'}`;
}

/* ===== PER-USER APP QUICK ACTIONS ===== */
let allSites = [];
let sitesLoaded = false;
const expandedUsers = new Set();

async function loadSitesOnce() {
  if (sitesLoaded) return;
  try {
    const data = await Auth.apiFetch('/sites');
    allSites = data.sites || [];
    sitesLoaded = true;
  } catch {
    allSites = [];
  }
}

function sitesForUser(u) {
  if (u.role === 'admin' || !u.allowedApps || !u.allowedApps.length) return allSites;
  // A nodejs site can be granted by its site name OR its PM2 process's own name (see
  // backend/lib/sites.js's canAccessSite) — check both so this preview matches what
  // the user would actually see.
  return allSites.filter(s => u.allowedApps.includes(s.name) || (s.pm2Name && u.allowedApps.includes(s.pm2Name)));
}

function badge(st) {
  const m = { online: 'b-online', stopped: 'b-stopped', errored: 'b-errored', launching: 'b-launching' };
  return `<span class="badge ${m[st] || 'b-default'}">${st || '—'}</span>`;
}

function renderUserApps(u) {
  const sites = sitesForUser(u);
  // Buttons here reflect what THIS user's own role permits (Permission Matrix: Deploy
  // and Restart/Stop/Start are operator+admin only) — not what the viewing admin could
  // always do — so this panel accurately answers "what can this user do", not "what
  // could I do to their apps".
  const canOperate = u.role === 'admin' || u.role === 'operator';
  const restartable = canOperate ? sites.filter(s => s.type === 'nodejs' && s.pm2Id !== null) : [];

  if (!sites.length) {
    return '<div style="padding:14px 20px;color:var(--muted);font-size:.83rem">No applications in scope.</div>';
  }

  return `
    <div style="padding:14px 20px">
      ${!canOperate ? `<div style="font-size:.78rem;color:var(--muted);margin-bottom:10px"><i class="fa-solid fa-eye"></i> Viewer role — read-only, no actions available.</div>` : ''}
      ${restartable.length ? `
        <div style="margin-bottom:10px">
          <button class="btn btn-ghost btn-sm" onclick="restartAllForUser('${esc(u.id)}', this)">
            <i class="fa-solid fa-rotate-right"></i> Restart All (${restartable.length})
          </button>
        </div>
      ` : ''}
      <table class="dtable" style="font-size:.8rem">
        <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${sites.map(s => `
            <tr>
              <td>${esc(s.name)}</td>
              <td>${s.type === 'nodejs' ? '<span class="badge b-online" style="background:var(--indigo-dim);color:var(--indigo)"><i class="fa-brands fa-node-js"></i> Node.js</span>' : '<span class="badge b-default">Static</span>'}</td>
              <td>${s.type === 'nodejs' ? badge(s.status) : '<span style="color:var(--muted)">—</span>'}</td>
              <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                  ${canOperate ? `
                    <button class="btn btn-ghost btn-sm" onclick="openDeployModal('${esc(s.id)}','${esc(s.name)}')" title="Deploy">
                      <i class="fa-solid fa-upload"></i>
                    </button>
                    ${s.type === 'nodejs' && s.pm2Id !== null ? `
                      <button class="btn btn-ghost btn-sm" onclick="appAction(${s.pm2Id},'restart',this)" title="Restart"><i class="fa-solid fa-rotate-right"></i></button>
                      <button class="btn btn-ghost btn-sm" onclick="appAction(${s.pm2Id},'stop',this)" title="Stop"><i class="fa-solid fa-stop"></i></button>
                      <button class="btn btn-ghost btn-sm" onclick="appAction(${s.pm2Id},'start',this)" title="Start"><i class="fa-solid fa-play"></i></button>
                    ` : ''}
                  ` : '<span style="color:var(--muted)">—</span>'}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function toggleUserApps(id) {
  if (expandedUsers.has(id)) {
    expandedUsers.delete(id);
  } else {
    await loadSitesOnce();
    expandedUsers.add(id);
  }
  renderUsers();
}

async function appAction(pm2Id, action, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await Auth.apiFetch(`/apps/${pm2Id}/${action}`, { method: 'POST' });
    toast(`${action.charAt(0).toUpperCase() + action.slice(1)} OK`, 'success');
    sitesLoaded = false;
    await loadSitesOnce();
    renderUsers();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function restartAllForUser(id, btn) {
  const u = users.find(x => x.id === id);
  if (!u) return;
  const targets = sitesForUser(u).filter(s => s.type === 'nodejs' && s.pm2Id !== null);
  if (!targets.length) return;

  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Restarting…';
  try {
    const results = await Promise.allSettled(targets.map(s => Auth.apiFetch(`/apps/${s.pm2Id}/restart`, { method: 'POST' })));
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed) toast(`${targets.length - failed} of ${targets.length} restarted`, 'warning');
    else toast(`Restarted ${targets.length} app${targets.length === 1 ? '' : 's'}`, 'success');
    sitesLoaded = false;
    await loadSitesOnce();
    renderUsers();
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

/* ===== LOAD USERS ===== */
let users = [];

async function loadUsers() {
  try {
    const data = await Auth.apiFetch('/users');
    users = data.users || [];
    renderUsers();
    document.getElementById('userCount').textContent = users.length;
  } catch (e) {
    document.getElementById('usersTbody').innerHTML =
      `<tr><td colspan="6" class="tl" style="color:var(--red)"><i class="fa-solid fa-circle-xmark"></i> ${esc(e.message)}</td></tr>`;
  }
}

function renderUsers() {
  const tbody = document.getElementById('usersTbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="tl">No users found.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const isSelf = u.id === me.id;
    const expanded = expandedUsers.has(u.id);
    return `
      <tr>
        <td>
          <button class="btn btn-ghost btn-sm" style="padding:4px 8px" onclick="toggleUserApps('${esc(u.id)}')" title="Show apps">
            <i class="fa-solid fa-chevron-${expanded ? 'down' : 'right'}"></i>
          </button>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="u-avatar" style="width:30px;height:30px;font-size:.8rem;flex-shrink:0">${esc(u.username[0].toUpperCase())}</div>
            <span>${esc(u.username)}${isSelf ? ' <span style="font-size:.7rem;color:var(--muted)">(you)</span>' : ''}</span>
          </div>
        </td>
        <td>${roleBadge(u.role)}</td>
        <td style="font-size:.85rem">${appsSummary(u)}</td>
        <td style="color:var(--muted);font-size:.8rem">${fmtDate(u.created_at)}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="openEditModal('${esc(u.id)}')">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button class="btn btn-ghost btn-sm" onclick="openPwdModal('${esc(u.id)}', '${esc(u.username)}')">
              <i class="fa-solid fa-key"></i> Password
            </button>
            ${!isSelf ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${esc(u.id)}', '${esc(u.username)}', this)">
              <i class="fa-solid fa-trash"></i> Delete
            </button>` : ''}
          </div>
        </td>
      </tr>
      ${expanded ? `<tr><td colspan="6" style="padding:0;background:var(--bg-surface)">${renderUserApps(u)}</td></tr>` : ''}
    `;
  }).join('');
}

/* ===== ADD / EDIT MODAL ===== */
let editingId = null;

async function openAddModal() {
  await loadAppNames();
  editingId = null;
  document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-user-plus"></i> Add User';
  document.getElementById('mUsername').value = '';
  document.getElementById('mPassword').value = '';
  document.getElementById('mRole').value = 'viewer';
  document.getElementById('pwdGroup').classList.remove('hidden');
  document.getElementById('modalErr').classList.add('hidden');
  document.getElementById('modalErr').textContent = '';
  renderAppChecklist([]);
  setAppsGroupMode('viewer', []);
  document.getElementById('userModal').classList.remove('hidden');
  document.getElementById('mUsername').focus();
}

async function openEditModal(id) {
  const u = users.find(x => x.id === id);
  if (!u) return;
  await loadAppNames();
  editingId = id;
  document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit User';
  document.getElementById('mUsername').value = u.username;
  document.getElementById('mPassword').value = '';
  document.getElementById('mRole').value = u.role;
  document.getElementById('pwdGroup').classList.add('hidden');
  document.getElementById('modalErr').classList.add('hidden');
  document.getElementById('modalErr').textContent = '';
  const selected = u.allowedApps || [];
  renderAppChecklist(selected);
  setAppsGroupMode(u.role, selected);
  document.getElementById('userModal').classList.remove('hidden');
  document.getElementById('mUsername').focus();
}

function closeModal() {
  document.getElementById('userModal').classList.add('hidden');
}

document.getElementById('addUserBtn').onclick = openAddModal;
document.getElementById('modalClose').onclick = closeModal;
document.getElementById('modalCancel').onclick = closeModal;
document.getElementById('userModal').addEventListener('click', e => {
  if (e.target === document.getElementById('userModal')) closeModal();
});

document.getElementById('modalSave').onclick = async () => {
  const username = document.getElementById('mUsername').value.trim();
  const password = document.getElementById('mPassword').value;
  const role     = document.getElementById('mRole').value;
  const errEl    = document.getElementById('modalErr');

  errEl.classList.add('hidden');
  errEl.textContent = '';

  if (!username) { showModalErr('Username is required'); return; }
  if (!editingId && !password) { showModalErr('Password is required'); return; }
  if (!editingId && password.length < 6) { showModalErr('Password must be at least 6 characters'); return; }

  const btn = document.getElementById('modalSave');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  const allowedApps = getSelectedApps();

  try {
    if (editingId) {
      await Auth.apiFetch(`/users/${editingId}`, { method: 'PUT', body: JSON.stringify({ username, role, allowedApps }) });
      toast('User updated', 'success');
    } else {
      await Auth.apiFetch('/users', { method: 'POST', body: JSON.stringify({ username, password, role, allowedApps }) });
      toast('User created', 'success');
    }
    closeModal();
    await loadUsers();
  } catch (e) {
    showModalErr(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

function showModalErr(msg) {
  const el = document.getElementById('modalErr');
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ===== PASSWORD MODAL ===== */
let pwdTargetId = null;

function openPwdModal(id, username) {
  pwdTargetId = id;
  document.getElementById('pwdTargetName').textContent = username;
  document.getElementById('newPassword').value = '';
  document.getElementById('pwdErr').classList.add('hidden');
  document.getElementById('pwdErr').textContent = '';
  document.getElementById('pwdModal').classList.remove('hidden');
  document.getElementById('newPassword').focus();
}

function closePwdModal() {
  document.getElementById('pwdModal').classList.add('hidden');
  pwdTargetId = null;
}

document.getElementById('pwdModalClose').onclick = closePwdModal;
document.getElementById('pwdCancel').onclick = closePwdModal;
document.getElementById('pwdModal').addEventListener('click', e => {
  if (e.target === document.getElementById('pwdModal')) closePwdModal();
});

document.getElementById('pwdSave').onclick = async () => {
  const password = document.getElementById('newPassword').value;
  if (password.length < 6) {
    document.getElementById('pwdErr').textContent = 'Password must be at least 6 characters';
    document.getElementById('pwdErr').classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('pwdSave');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    await Auth.apiFetch(`/users/${pwdTargetId}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
    toast('Password updated', 'success');
    closePwdModal();
  } catch (e) {
    document.getElementById('pwdErr').textContent = e.message;
    document.getElementById('pwdErr').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== DELETE USER ===== */
const deleteTimers = {};

async function deleteUser(id, username, btn) {
  if (deleteTimers[id]) {
    clearTimeout(deleteTimers[id]);
    delete deleteTimers[id];

    const orig = btn.dataset.orig;
    btn.innerHTML = orig;
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.onclick = () => deleteUser(id, username, btn);

    try {
      btn.disabled = true;
      await Auth.apiFetch(`/users/${id}`, { method: 'DELETE' });
      toast(`Deleted ${username}`, 'success');
      await loadUsers();
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
    return;
  }

  btn.dataset.orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Confirm?';
  btn.style.background = 'var(--red)';
  btn.style.borderColor = 'var(--red)';

  deleteTimers[id] = setTimeout(() => {
    delete deleteTimers[id];
    if (btn.isConnected) {
      btn.innerHTML = btn.dataset.orig;
      btn.style.background = '';
      btn.style.borderColor = '';
    }
  }, 4000);
}

/* ===== DEPLOY MODAL ===== */
let deployTargetId = null;

function openDeployModal(id, name) {
  deployTargetId = id;
  document.getElementById('deployTargetName').textContent = name;
  document.getElementById('deployFile').value = '';
  document.getElementById('deployErr').classList.add('hidden');
  document.getElementById('deployErr').textContent = '';
  document.getElementById('deployPbarWrap').classList.add('hidden');
  document.getElementById('deployPbar').style.width = '0%';
  document.getElementById('deployModal').classList.remove('hidden');
}

function closeDeployModal() {
  document.getElementById('deployModal').classList.add('hidden');
  deployTargetId = null;
}

document.getElementById('deployModalClose').onclick = closeDeployModal;
document.getElementById('deployCancel').onclick = closeDeployModal;
document.getElementById('deployModal').addEventListener('click', e => {
  if (e.target === document.getElementById('deployModal')) closeDeployModal();
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

document.getElementById('deploySave').onclick = async () => {
  const fileInput = document.getElementById('deployFile');
  const file = fileInput.files[0];
  const errEl = document.getElementById('deployErr');
  errEl.classList.add('hidden');

  if (!file) { errEl.textContent = 'Choose a .zip file first'; errEl.classList.remove('hidden'); return; }
  if (!/\.zip$/i.test(file.name)) { errEl.textContent = 'Only .zip files are accepted'; errEl.classList.remove('hidden'); return; }

  const btn = document.getElementById('deploySave');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deploying…';
  document.getElementById('deployPbarWrap').classList.remove('hidden');

  try {
    const res = await uploadZip(deployTargetId, file, pct => {
      document.getElementById('deployPbar').style.width = pct + '%';
    });
    toast(res.message || 'Deployed', 'success');
    closeDeployModal();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== REFRESH ===== */
document.getElementById('refreshUsers').onclick = loadUsers;

/* ===== BOOT ===== */
loadUsers();
