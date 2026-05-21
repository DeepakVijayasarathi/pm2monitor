const Auth = (() => {
  const TOKEN_KEY = 'pm2_monitor_token';
  const USER_KEY = 'pm2_monitor_user';
  const API_BASE = '/api';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function isAuthenticated() { return !!getToken(); }

  async function login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setSession(data.token, data.user);
    return data;
  }

  async function logout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {}
    clearSession();
    window.location.href = '/login.html';
  }

  async function apiFetch(endpoint, options = {}) {
    const token = getToken();
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });

    if (res.status === 401 || res.status === 403) {
      clearSession();
      window.location.href = '/login.html';
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  function requireAuth() {
    if (!isAuthenticated()) {
      window.location.href = '/login.html';
    }
  }

  function requireAdmin() {
    const user = getUser();
    if (!user || user.role !== 'admin') {
      window.location.href = '/';
    }
  }

  return { getToken, getUser, login, logout, apiFetch, isAuthenticated, requireAuth, requireAdmin };
})();
