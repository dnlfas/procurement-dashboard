import { state, SETTINGS_KEY } from './state.js';

let _initCallback = null;
export function setInitCallback(fn) { _initCallback = fn; }

export async function checkAuth() {
  try {
    const r = await fetch('/api/check-auth');
    const j = await r.json();
    if (j.ok) {
      document.getElementById('login-screen').style.display = 'none';
      if (_initCallback) _initCallback();
    }
  } catch(e) { /* network error — keep login screen */ }
}

export async function doLogin() {
  const pw = document.getElementById('ls-pw').value;
  document.getElementById('ls-err').style.display = 'none';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (r.ok) {
      document.getElementById('login-screen').style.display = 'none';
      if (_initCallback) _initCallback();
    } else {
      document.getElementById('ls-err').style.display = 'block';
      document.getElementById('ls-pw').select();
    }
  } catch(e) { document.getElementById('ls-err').style.display = 'block'; }
}

export async function doLogout() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}
