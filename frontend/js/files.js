Auth.requireAuth();

const me = Auth.getUser();
const canManageUsers = Auth.hasPermission('users', 'read');
const isOperator = Auth.hasPermission('files', 'write');
const isAdmin    = Auth.hasPermission('files', 'delete');

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
  if (canManageUsers) document.querySelectorAll('.admin-only').forEach(e => e.classList.remove('hidden'));
}
document.getElementById('userBtn').onclick = e => {
  e.stopPropagation();
  document.getElementById('userDrop').classList.toggle('hidden');
};
document.addEventListener('click', () => {
  document.getElementById('userDrop').classList.add('hidden');
  closeAllKebabs();
});
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

const IMAGE_EXT = new Set(['jpg','jpeg','png','gif','svg','webp','bmp','ico']);
function isImage(name) {
  const ext = name.toLowerCase().includes('.') ? name.toLowerCase().split('.').pop() : '';
  return IMAGE_EXT.has(ext);
}

/* ===== STATE ===== */
let currentPath = '';
let entries = [];
let siteOwner = '';
let selected = new Set();
let sortBy = 'name';
let sortDir = 'asc';
let showHidden = false;
let searchQuery = '';

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
    siteOwner = data.owner || '';
    selected.clear();
    updateBulkBar();
    renderBreadcrumbs();
    renderTable();
  } catch (e) {
    document.getElementById('filesTbody').innerHTML =
      `<tr><td colspan="6" class="tl" style="color:var(--red)"><i class="fa-solid fa-circle-xmark"></i> ${esc(e.message)}</td></tr>`;
  }
}

function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

function iconFor(entry) {
  if (entry.type === 'dir') return 'fa-solid fa-folder';
  if (isImage(entry.name)) return 'fa-solid fa-file-image';
  if (isEditable(entry.name)) return 'fa-solid fa-file-lines';
  return 'fa-solid fa-file';
}

/* ===== FILTER + SORT ===== */
function getVisibleEntries() {
  let list = entries;
  if (!showHidden) list = list.filter(e => !e.name.startsWith('.'));
  const q = searchQuery.trim().toLowerCase();
  if (q) list = list.filter(e => e.name.toLowerCase().includes(q));

  const dir = sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    if (sortBy === 'size') return ((a.size || 0) - (b.size || 0)) * dir;
    if (sortBy === 'modified') return (new Date(a.modified) - new Date(b.modified)) * dir;
    return a.name.localeCompare(b.name) * dir;
  });
}

document.getElementById('searchInput').addEventListener('input', e => { searchQuery = e.target.value; renderTable(); });
document.getElementById('showHidden').addEventListener('change', e => { showHidden = e.target.checked; renderTable(); });
document.querySelectorAll('[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortBy === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortBy = key; sortDir = 'asc'; }
    renderTable();
  });
});

/* ===== SELECTION ===== */
function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = selected.size;
  document.getElementById('bulkCount').textContent = count;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('bulkCompressBtn').classList.toggle('hidden', !isOperator);
  document.getElementById('bulkMoveBtn').classList.toggle('hidden', !isOperator);
  document.getElementById('bulkDeleteBtn').classList.toggle('hidden', !isAdmin);
  document.getElementById('selectAll').checked = count > 0 && count === getVisibleEntries().length;
}

document.getElementById('selectAll').addEventListener('change', e => {
  selected.clear();
  if (e.target.checked) getVisibleEntries().forEach(en => selected.add(joinPath(currentPath, en.name)));
  renderTable();
});

/* ===== TABLE ===== */
function renderTable() {
  const tbody = document.getElementById('filesTbody');
  document.getElementById('newFolderBtn').classList.toggle('hidden', !isOperator);
  document.getElementById('uploadFilesBtn').classList.toggle('hidden', !isOperator);

  const visible = getVisibleEntries();
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="tl">${entries.length ? 'No matches.' : 'Empty folder.'}</td></tr>`;
    updateBulkBar();
    return;
  }

  tbody.innerHTML = visible.map((e, idx) => {
    const full = joinPath(currentPath, e.name);
    const nameCell = e.type === 'dir'
      ? `<a href="#" onclick="event.preventDefault();loadDir('${esc(full)}')"><i class="${iconFor(e)}"></i> ${esc(e.name)}</a>`
      : `<span><i class="${iconFor(e)}"></i> ${esc(e.name)}</span>`;

    const inline = [];
    if (e.type === 'file' && isImage(e.name)) {
      inline.push(`<button class="btn btn-ghost btn-sm" title="Preview" onclick="previewImage('${esc(full)}','${esc(e.name)}')"><i class="fa-solid fa-eye"></i></button>`);
    }
    if (e.type === 'file' && isEditable(e.name)) {
      inline.push(`<button class="btn btn-ghost btn-sm" title="Edit" onclick="openEdit('${esc(full)}','${esc(e.name)}')"><i class="fa-solid fa-pen"></i></button>`);
    }

    const menu = [];
    if (e.type === 'file') {
      menu.push(`<button onclick="downloadFile('${esc(full)}','${esc(e.name)}')"><i class="fa-solid fa-download"></i> Download</button>`);
    }
    if (isOperator) {
      menu.push(`<button onclick="openRename('${esc(full)}','${esc(e.name)}')"><i class="fa-solid fa-i-cursor"></i> Rename</button>`);
      menu.push(`<button onclick="openMoveCopy('move',['${esc(full)}'])"><i class="fa-solid fa-arrows-up-down-left-right"></i> Move</button>`);
      menu.push(`<button onclick="openMoveCopy('copy',['${esc(full)}'])"><i class="fa-solid fa-copy"></i> Copy</button>`);
      if (e.type === 'file' && /\.zip$/i.test(e.name)) {
        menu.push(`<button onclick="extractZip('${esc(full)}')"><i class="fa-solid fa-box-open"></i> Extract</button>`);
      }
    }
    if (isAdmin) {
      menu.push(`<button onclick="openPermissions('${esc(full)}','${esc(e.name)}','${e.mode}')"><i class="fa-solid fa-lock"></i> Permissions</button>`);
    }
    if (isAdmin) {
      menu.push(`<button onclick="deleteEntry('${esc(full)}')" style="color:var(--red)"><i class="fa-solid fa-trash"></i> Delete</button>`);
    }

    return `
      <tr>
        <td><input type="checkbox" class="row-check" data-path="${esc(full)}" ${selected.has(full) ? 'checked' : ''}/></td>
        <td>${nameCell}</td>
        <td style="color:var(--muted);font-size:.8rem">${fmtBytes(e.size)}</td>
        <td style="color:var(--muted);font-size:.8rem">${fmtDate(e.modified)}</td>
        <td class="mono" style="color:var(--muted);font-size:.75rem">${e.mode || '—'}</td>
        <td>
          <div style="display:flex;gap:2px;align-items:center;position:relative">
            ${inline.join('')}
            ${menu.length ? `
            <div style="position:relative;display:inline-block">
              <button class="btn btn-ghost btn-sm kebab-btn" data-idx="${idx}" onclick="event.stopPropagation();toggleKebab(${idx})"><i class="fa-solid fa-ellipsis-vertical"></i></button>
              <div class="user-drop hidden" id="kebab-${idx}" style="right:0">${menu.join('')}</div>
            </div>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.path);
      else selected.delete(cb.dataset.path);
      updateBulkBar();
    });
  });

  updateBulkBar();
}

/* ===== KEBAB MENU ===== */
function closeAllKebabs() {
  document.querySelectorAll('[id^="kebab-"]').forEach(el => el.classList.add('hidden'));
}
function toggleKebab(idx) {
  const el = document.getElementById(`kebab-${idx}`);
  const wasOpen = !el.classList.contains('hidden');
  closeAllKebabs();
  if (!wasOpen) el.classList.remove('hidden');
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
  closeAllKebabs();
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

/* ===== MOVE / COPY (single item via kebab, or bulk via selection) ===== */
let moveCopyMode = 'move';
let moveCopyItems = [];

function openMoveCopy(mode, items) {
  closeAllKebabs();
  moveCopyMode = mode;
  moveCopyItems = items;
  document.getElementById('moveCopyTitle').textContent = mode === 'move' ? 'Move' : 'Copy';
  document.getElementById('moveCopySummary').textContent =
    items.length === 1 ? items[0] : `${items.length} items selected`;
  document.getElementById('moveCopyDest').value = currentPath || '.';
  document.getElementById('moveCopyErr').classList.add('hidden');
  document.getElementById('moveCopyModal').classList.remove('hidden');
  document.getElementById('moveCopyDest').focus();
}
document.getElementById('moveCopyModalClose').onclick = () => document.getElementById('moveCopyModal').classList.add('hidden');
document.getElementById('moveCopyCancel').onclick = () => document.getElementById('moveCopyModal').classList.add('hidden');
document.getElementById('bulkMoveBtn').onclick = () => openMoveCopy('move', [...selected]);

document.getElementById('moveCopySave').onclick = async () => {
  const errEl = document.getElementById('moveCopyErr');
  errEl.classList.add('hidden');
  const destDir = document.getElementById('moveCopyDest').value.trim() || '.';
  const endpoint = moveCopyMode === 'move' ? '/rename' : '/copy';

  const btn = document.getElementById('moveCopySave');
  btn.disabled = true;
  let failures = 0;
  for (const from of moveCopyItems) {
    const name = from.split('/').pop();
    const to = destDir === '.' ? name : `${destDir}/${name}`;
    try {
      await Auth.apiFetch(apiPath(endpoint), { method: 'POST', body: JSON.stringify({ from, to }) });
    } catch (e) {
      failures++;
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  }
  btn.disabled = false;
  if (failures === 0) {
    document.getElementById('moveCopyModal').classList.add('hidden');
    toast(moveCopyMode === 'move' ? 'Moved' : 'Copied', 'success');
    selected.clear();
    await loadDir(currentPath);
  } else if (failures < moveCopyItems.length) {
    toast(`${moveCopyItems.length - failures} of ${moveCopyItems.length} succeeded`, 'warning');
    selected.clear();
    await loadDir(currentPath);
  }
};

/* ===== PERMISSIONS ===== */
let permTarget = null;
function modeToRwx(mode) {
  const bits = String(mode || '000').padStart(3, '0').split('').map(Number);
  return bits.map(b => (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-')).join('');
}
function openPermissions(full, name, mode) {
  closeAllKebabs();
  permTarget = full;
  document.getElementById('permFileName').textContent = name;
  document.getElementById('permOwner').textContent = siteOwner ? `${siteOwner}` : '—';
  document.getElementById('permMode').value = mode || '644';
  document.getElementById('permPreview').textContent = modeToRwx(mode);
  document.getElementById('permErr').classList.add('hidden');
  document.getElementById('permModal').classList.remove('hidden');
}
document.getElementById('permModalClose').onclick = () => document.getElementById('permModal').classList.add('hidden');
document.getElementById('permCancel').onclick = () => document.getElementById('permModal').classList.add('hidden');
document.getElementById('permMode').addEventListener('input', e => {
  document.getElementById('permPreview').textContent = modeToRwx(e.target.value);
});
document.getElementById('permSave').onclick = async () => {
  const errEl = document.getElementById('permErr');
  errEl.classList.add('hidden');
  const mode = document.getElementById('permMode').value.trim();
  if (!/^[0-7]{3}$/.test(mode)) { errEl.textContent = 'Mode must be 3 octal digits, e.g. 755'; errEl.classList.remove('hidden'); return; }
  try {
    await Auth.apiFetch(apiPath('/permissions'), { method: 'PUT', body: JSON.stringify({ path: permTarget, mode }) });
    document.getElementById('permModal').classList.add('hidden');
    toast('Permissions updated', 'success');
    await loadDir(currentPath);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
};

/* ===== EXTRACT ===== */
async function extractZip(full) {
  closeAllKebabs();
  try {
    const res = await Auth.apiFetch(apiPath('/extract'), { method: 'POST', body: JSON.stringify({ path: full }) });
    toast(res.message || 'Extracted', 'success');
    await loadDir(currentPath);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ===== COMPRESS ===== */
document.getElementById('bulkCompressBtn').onclick = () => {
  document.getElementById('compressName').value = 'archive.zip';
  document.getElementById('compressErr').classList.add('hidden');
  document.getElementById('compressModal').classList.remove('hidden');
  document.getElementById('compressName').focus();
};
document.getElementById('compressModalClose').onclick = () => document.getElementById('compressModal').classList.add('hidden');
document.getElementById('compressCancel').onclick = () => document.getElementById('compressModal').classList.add('hidden');
document.getElementById('compressSave').onclick = async () => {
  const errEl = document.getElementById('compressErr');
  errEl.classList.add('hidden');
  let name = document.getElementById('compressName').value.trim();
  if (!name) { errEl.textContent = 'Name is required'; errEl.classList.remove('hidden'); return; }
  if (!/\.zip$/i.test(name)) name += '.zip';
  try {
    const res = await Auth.apiFetch(apiPath('/compress'), { method: 'POST', body: JSON.stringify({ paths: [...selected], name }) });
    document.getElementById('compressModal').classList.add('hidden');
    toast(res.message || 'Created', 'success');
    selected.clear();
    await loadDir(currentPath);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
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
async function fetchBlob(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${Auth.getToken()}` } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.blob();
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function downloadFile(full, name) {
  closeAllKebabs();
  try {
    const blob = await fetchBlob(`/api${apiPath(`/download?path=${encodeURIComponent(full)}`)}`);
    saveBlob(blob, name);
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ===== IMAGE PREVIEW ===== */
let currentPreviewUrl = null;
function revokePreviewUrl() {
  if (currentPreviewUrl) { URL.revokeObjectURL(currentPreviewUrl); currentPreviewUrl = null; }
}
async function previewImage(full, name) {
  try {
    const blob = await fetchBlob(`/api${apiPath(`/download?path=${encodeURIComponent(full)}`)}`);
    revokePreviewUrl();
    currentPreviewUrl = URL.createObjectURL(blob);
    document.getElementById('previewFileName').textContent = name;
    document.getElementById('previewImg').src = currentPreviewUrl;
    document.getElementById('previewModal').classList.remove('hidden');
  } catch (e) {
    toast(e.message, 'error');
  }
}
document.getElementById('previewModalClose').onclick = () => {
  document.getElementById('previewModal').classList.add('hidden');
  document.getElementById('previewImg').src = '';
  revokePreviewUrl();
};

/* ===== BULK DOWNLOAD ===== */
document.getElementById('bulkDownloadBtn').onclick = async () => {
  try {
    const res = await fetch(`/api${apiPath('/bulk-download')}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Auth.getToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [...selected] }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Request failed (${res.status})`); }
    saveBlob(await res.blob(), `${SITE_NAME || 'files'}-selection.zip`);
  } catch (e) {
    toast(e.message, 'error');
  }
};

/* ===== DELETE (single + bulk) ===== */
async function deleteEntry(full) {
  closeAllKebabs();
  const name = full.split('/').pop();
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    await Auth.apiFetch(apiPath(`?path=${encodeURIComponent(full)}`), { method: 'DELETE' });
    toast('Deleted', 'success');
    await loadDir(currentPath);
  } catch (e) {
    toast(e.message, 'error');
  }
}

document.getElementById('bulkDeleteBtn').onclick = async () => {
  if (!confirm(`Delete ${selected.size} selected item(s)? This cannot be undone.`)) return;
  try {
    const data = await Auth.apiFetch(apiPath('/bulk'), { method: 'DELETE', body: JSON.stringify({ paths: [...selected] }) });
    const failed = (data.results || []).filter(r => !r.ok);
    if (failed.length) toast(`${failed.length} item(s) failed: ${failed.map(f => f.error).join('; ')}`, 'error');
    else toast('Deleted', 'success');
    selected.clear();
    await loadDir(currentPath);
  } catch (e) {
    toast(e.message, 'error');
  }
};

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
