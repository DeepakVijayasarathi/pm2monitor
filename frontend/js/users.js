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

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ROLE_ORDER = ['admin', 'operator', 'viewer'];

function roleBadge(role) {
  return `<span class="role-badge rb-${role}">${role}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
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
      `<tr><td colspan="4" class="tl" style="color:var(--red)"><i class="fa-solid fa-circle-xmark"></i> ${esc(e.message)}</td></tr>`;
  }
}

function renderUsers() {
  const tbody = document.getElementById('usersTbody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="tl">No users found.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const isSelf = u.id === me.id;
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="u-avatar" style="width:30px;height:30px;font-size:.8rem;flex-shrink:0">${esc(u.username[0].toUpperCase())}</div>
            <span>${esc(u.username)}${isSelf ? ' <span style="font-size:.7rem;color:var(--muted)">(you)</span>' : ''}</span>
          </div>
        </td>
        <td>${roleBadge(u.role)}</td>
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
    `;
  }).join('');
}

/* ===== ADD / EDIT MODAL ===== */
let editingId = null;

function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-user-plus"></i> Add User';
  document.getElementById('mUsername').value = '';
  document.getElementById('mPassword').value = '';
  document.getElementById('mRole').value = 'viewer';
  document.getElementById('pwdGroup').classList.remove('hidden');
  document.getElementById('modalErr').classList.add('hidden');
  document.getElementById('modalErr').textContent = '';
  document.getElementById('userModal').classList.remove('hidden');
  document.getElementById('mUsername').focus();
}

function openEditModal(id) {
  const u = users.find(x => x.id === id);
  if (!u) return;
  editingId = id;
  document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit User';
  document.getElementById('mUsername').value = u.username;
  document.getElementById('mPassword').value = '';
  document.getElementById('mRole').value = u.role;
  document.getElementById('pwdGroup').classList.add('hidden');
  document.getElementById('modalErr').classList.add('hidden');
  document.getElementById('modalErr').textContent = '';
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

  try {
    if (editingId) {
      await Auth.apiFetch(`/users/${editingId}`, { method: 'PUT', body: JSON.stringify({ username, role }) });
      toast('User updated', 'success');
    } else {
      await Auth.apiFetch('/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
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

/* ===== REFRESH ===== */
document.getElementById('refreshUsers').onclick = loadUsers;

/* ===== BOOT ===== */
loadUsers();
