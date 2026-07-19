Auth.requireAuth();

const me = Auth.getUser();
const isAdmin    = me?.role === 'admin';
const isOperator = me?.role === 'admin' || me?.role === 'operator';

const params = new URLSearchParams(location.search);
const SITE_ID = params.get('site');
const SITE_NAME = params.get('name') || '';
if (!SITE_ID) location.href = '/sites.html';

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

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = iso => iso ? new Date(iso).toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const fmtBytes = b => { if (b === null || b === undefined) return '—'; if (!b) return '0 B'; const u = ['B','KB','MB','GB','TB']; const i = Math.floor(Math.log(b) / Math.log(1024)); return (b / Math.pow(1024, i)).toFixed(1) + ' ' + u[i]; };

document.getElementById('siteNameLabel').textContent = SITE_NAME;

const EDITABLE_EXT = new Set(['js','json','html','htm','css','txt','md','yml','yaml','xml','conf','ts','jsx','tsx','py','sh','env']);
const EDITABLE_NAMES = new Set(['.env', '.gitignore', 'dockerfile']);
function isEditable(name) {
  const lower = name.toLowerCase();
  if (EDITABLE_NAMES.has(lower)) return true;
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  return EDITABLE_EXT.has(ext);
}

/* ===== STATE ===== */
let currentPath = '';
let entries = [];

function apiPath(suffix) {
  return `/sites/${encodeURIComponent(SITE_ID)}/files${suffix}`;
}

/* ===== BREADCRUMBS ===== */
function renderBreadcrumbs() {
  const parts = currentPath ? currentPath.split('/').filter(Boolean) : [];
  let acc = '';
  const crumbs = [`<a href="#" data-path="">${esc(SITE_NAME) || 'root'}</a>`];
  for (const part of parts) {
    acc += (acc ? '/' : '') + part;
    crumbs.push(`<a href="#" data-path="${esc(acc)}">${esc(part)}</a>`);
  }
  document.getElementById('breadcrumbs').innerHTML =
    '<i class="fa-solid fa-folder-tree"></i> ' + crumbs.join(' <span style="color:var(--muted)">/</span> ');
  document.querySelectorAll('#breadcrumbs a').forEach(a => {
    a.onclick = e => { e.preventDefault(); loadDir(a.dataset.path); };
  });
}

/* ===== LOAD DIRECTORY ===== */
async function loadDir(p) {
  try {
    const data = await Auth.apiFetch(apiPath(`?path=${encodeURIComponent(p)}`));
    currentPath = data.path || '';
    entries = data.entries || [];
    renderBreadcrumbs();
    renderTable();
  } catch (e) {
    document.getElementById('filesTbody').innerHTML =
      `<tr><td colspan="4" class="tl" style="color:var(--red)"><i class="fa-solid fa-circle-xmark"></i> ${esc(e.message)}</td></tr>`;
  }
}

function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

function iconFor(entry) {
  if (entry.type === 'dir') return 'fa-solid fa-folder';
  if (isEditable(entry.name)) return 'fa-solid fa-file-lines';
  return 'fa-solid fa-file';
}

function renderTable() {
  const tbody = document.getElementById('filesTbody');
  document.getElementById('newFolderBtn').classList.toggle('hidden', !isOperator);
  document.getElementById('uploadFilesBtn').classList.toggle('hidden', !isOperator);

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="tl">Empty folder.</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(e => {
    const full = joinPath(currentPath, e.name);
    const nameCell = e.type === 'dir'
      ? `<a href="#" onclick="event.preventDefault();loadDir('${esc(full)}')"><i class="${iconFor(e)}"></i> ${esc(e.name)}</a>`
      : `<span><i class="${iconFor(e)}"></i> ${esc(e.name)}</span>`;

    const actions = [];
    if (e.type === 'file' && isEditable(e.name)) {
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="openEdit('${esc(full)}','${esc(e.name)}')"><i class="fa-solid fa-pen"></i></button>`);
    }
    if (e.type === 'file') {
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="downloadFile('${esc(full)}','${esc(e.name)}')"><i class="fa-solid fa-download"></i></button>`);
    }
    if (isOperator) {
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="openRename('${esc(full)}','${esc(e.name)}')"><i class="fa-solid fa-i-cursor"></i></button>`);
      actions.push(`<button class="btn btn-sm btn-danger" onclick="deleteEntry('${esc(full)}', this)"><i class="fa-solid fa-trash"></i></button>`);
    }

    return `
      <tr>
        <td>${nameCell}</td>
        <td style="color:var(--muted);font-size:.8rem">${fmtBytes(e.size)}</td>
        <td style="color:var(--muted);font-size:.8rem">${fmtDate(e.modified)}</td>
        <td><div style="display:flex;gap:4px;flex-wrap:wrap">${actions.join('')}</div></td>
      </tr>
    `;
  }).join('');
}

/* ===== NEW FOLDER ===== */
document.getElementById('newFolderBtn').onclick = () => {
  document.getElementById('mkdirName').value = '';
  document.getElementById('mkdirErr').classList.add('hidden');
  document.getElementById('mkdirModal').classList.remove('hidden');
  document.getElementById('mkdirName').focus();
};
document.getElementById('mkdirModalClose').onclick = () => document.getElementById('mkdirModal').classList.add('hidden');
document.getElementById('mkdirCancel').onclick = () => document.getElementById('mkdirModal').classList.add('hidden');
document.getElementById('mkdirSave').onclick = async () => {
  const name = document.getElementById('mkdirName').value.trim();
  if (!name) { document.getElementById('mkdirErr').textContent = 'Name is required'; document.getElementById('mkdirErr').classList.remove('hidden'); return; }
  try {
    await Auth.apiFetch(apiPath('/mkdir'), { method: 'POST', body: JSON.stringify({ path: joinPath(currentPath, name) }) });
    document.getElementById('mkdirModal').classList.add('hidden');
    toast('Folder created', 'success');
    await loadDir(currentPath);
  } catch (e) {
    document.getElementById('mkdirErr').textContent = e.message;
    document.getElementById('mkdirErr').classList.remove('hidden');
  }
};

/* ===== RENAME ===== */
let renameTarget = null;
function openRename(full, name) {
  renameTarget = full;
  document.getElementById('renameName').value = name;
  document.getElementById('renameErr').classList.add('hidden');
  document.getElementById('renameModal').classList.remove('hidden');
  document.getElementById('renameName').focus();
}
document.getElementById('renameModalClose').onclick = () => document.getElementById('renameModal').classList.add('hidden');
document.getElementById('renameCancel').onclick = () => document.getElementById('renameModal').classList.add('hidden');
document.getElementById('renameSave').onclick = async () => {
  const name = document.getElementById('renameName').value.trim();
  if (!name) { document.getElementById('renameErr').textContent = 'Name is required'; document.getElementById('renameErr').classList.remove('hidden'); return; }
  try {
    const to = joinPath(currentPath, name);
    await Auth.apiFetch(apiPath('/rename'), { method: 'POST', body: JSON.stringify({ from: renameTarget, to }) });
    document.getElementById('renameModal').classList.add('hidden');
    toast('Renamed', 'success');
    await loadDir(currentPath);
  } catch (e) {
    document.getElementById('renameErr').textContent = e.message;
    document.getElementById('renameErr').classList.remove('hidden');
  }
};

/* ===== EDIT ===== */
let editTarget = null;
async function openEdit(full, name) {
  try {
    const data = await Auth.apiFetch(apiPath(`/content?path=${encodeURIComponent(full)}`));
    editTarget = full;
    document.getElementById('editFileName').textContent = name;
    document.getElementById('editContent').value = data.content;
    document.getElementById('editTruncatedWarn').classList.toggle('hidden', !data.truncated);
    document.getElementById('editErr').classList.add('hidden');
    document.getElementById('editModal').classList.remove('hidden');
  } catch (e) {
    toast(e.message, 'error');
  }
}
document.getElementById('editModalClose').onclick = () => document.getElementById('editModal').classList.add('hidden');
document.getElementById('editCancel').onclick = () => document.getElementById('editModal').classList.add('hidden');
document.getElementById('editSave').onclick = async () => {
  const btn = document.getElementById('editSave');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  try {
    await Auth.apiFetch(apiPath('/content'), {
      method: 'PUT',
      body: JSON.stringify({ path: editTarget, content: document.getElementById('editContent').value }),
    });
    document.getElementById('editModal').classList.add('hidden');
    toast('Saved', 'success');
    await loadDir(currentPath);
  } catch (e) {
    document.getElementById('editErr').textContent = e.message;
    document.getElementById('editErr').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== DOWNLOAD ===== */
async function downloadFile(full, name) {
  try {
    const res = await fetch(`/api${apiPath(`/download?path=${encodeURIComponent(full)}`)}`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` },
    });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ===== DELETE ===== */
const deleteTimers = {};
async function deleteEntry(full, btn) {
  if (deleteTimers[full]) {
    clearTimeout(deleteTimers[full]);
    delete deleteTimers[full];
    const orig = btn.dataset.orig;
    btn.innerHTML = orig;
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.onclick = () => deleteEntry(full, btn);
    try {
      btn.disabled = true;
      await Auth.apiFetch(apiPath(`?path=${encodeURIComponent(full)}`), { method: 'DELETE' });
      toast('Deleted', 'success');
      await loadDir(currentPath);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
    return;
  }
  btn.dataset.orig = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
  btn.style.background = 'var(--red)';
  btn.style.borderColor = 'var(--red)';
  deleteTimers[full] = setTimeout(() => {
    delete deleteTimers[full];
    if (btn.isConnected) {
      btn.innerHTML = btn.dataset.orig;
      btn.style.background = '';
      btn.style.borderColor = '';
    }
  }, 4000);
}

/* ===== UPLOAD ===== */
document.getElementById('uploadFilesBtn').onclick = () => document.getElementById('uploadFilesInput').click();
document.getElementById('uploadFilesInput').onchange = async e => {
  const files = [...e.target.files];
  if (!files.length) return;
  e.target.value = '';

  const btn = document.getElementById('uploadFilesBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading…';

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api${apiPath(`/upload?path=${encodeURIComponent(currentPath)}`)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      xhr.send(fd);
    });
    toast('Uploaded', 'success');
    await loadDir(currentPath);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
};

/* ===== REFRESH ===== */
document.getElementById('refreshFiles').onclick = () => loadDir(currentPath);

/* ===== BOOT ===== */
loadDir('');
