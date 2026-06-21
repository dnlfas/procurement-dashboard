export function s(v) { return (v == null ? '' : String(v)).trim(); }
export function p2(n) { return String(n).padStart(2, '0'); }
export function esc(v) {
  return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
export function fd(d) {
  return d ? p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) : '—';
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  // use state._tt to avoid circular import — just use a local timeout
  clearTimeout(toast._tt);
  toast._tt = setTimeout(() => t.classList.remove('show'), 2600);
}

export function showQR() {
  const modal = document.getElementById('qr-modal');
  modal.style.display = 'flex';
  if (window.QRCode) { _renderQR(); return; }
  const sc = document.createElement('script');
  sc.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
  sc.onload = _renderQR;
  document.head.appendChild(sc);
}
function _renderQR() {
  const url = location.origin + (location.pathname === '/' ? '' : location.pathname);
  document.getElementById('qr-url').textContent = url;
  const c = document.getElementById('qr-canvas');
  c.innerHTML = '';
  new QRCode(c, { text: url, width: 200, height: 200, colorDark: '#000000', colorLight: '#ffffff' });
}
export function closeQR() { document.getElementById('qr-modal').style.display = 'none'; }

export function autoH(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

export function expandNotes(root) {
  (root || document).querySelectorAll('.note-ta,.sonote-ta').forEach(function(t) {
    if (t.value) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  });
}
