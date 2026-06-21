import { state, SETTINGS_KEY } from './state.js';
import { p2, toast } from './utils.js';
import { parseRows, buildGroups } from './parse/so.js';
import { parsePORows, linkPOtoSO } from './parse/po.js';
import { applyOverridesToRows } from './persistence.js';
import { withXLSX } from './upload.js';

// Callbacks set by main.js
let _onDataLoaded = null;
export function setApiCallbacks(onDataLoaded) { _onDataLoaded = onDataLoaded; }

export function openSettings() {
  document.getElementById('set-so-url').value = state.odSettings.soUrl || '';
  document.getElementById('set-po-url').value = state.odSettings.poUrl || '';
  document.getElementById('settings-overlay').classList.add('open');
  document.getElementById('btn-refresh-now').style.display = state.odSettings.soUrl ? 'inline-flex' : 'none';
  setSettingsStatus('');
}

export function closeSettings() { document.getElementById('settings-overlay').classList.remove('open'); }

export function markInputChanged(el) { el.classList.toggle('has-val', !!el.value.trim()); }

export function setSettingsStatus(msg, type) {
  const el = document.getElementById('settings-status');
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.className = 'settings-status' + (type ? ' ' + type : '');
  el.textContent = msg;
}

export function saveAndFetch() {
  const soUrl = document.getElementById('set-so-url').value.trim();
  const poUrl = document.getElementById('set-po-url').value.trim();
  if (!soUrl) { setSettingsStatus('נדרש לינק SO לפחות', 'err'); return; }
  state.odSettings = { soUrl, poUrl, savedAt: new Date().toISOString() };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.odSettings));
  setSettingsStatus('שומר ושולף...', '');
  fetchNow();
}

export function clearSettings() {
  state.odSettings = {};
  localStorage.removeItem(SETTINGS_KEY);
  document.getElementById('set-so-url').value = '';
  document.getElementById('set-po-url').value = '';
  setSettingsStatus('ההגדרות נמחקו', '');
  document.getElementById('btn-refresh-now').style.display = 'none';
}

export function gdToDirectUrl(shareUrl) {
  if (!shareUrl) return null;
  if (shareUrl.includes('export=download') || shareUrl.includes('uc?id=')) return shareUrl;
  let fileId = null;
  const m1 = shareUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const m2 = shareUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const m3 = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) fileId = m1[1];
  else if (m2) fileId = m2[1];
  else if (m3) fileId = m3[1];
  if (!fileId) return shareUrl;
  return 'https://drive.google.com/uc?export=download&id=' + fileId;
}

export async function fetchFileFromUrl(url, label) {
  const directUrl = gdToDirectUrl(url);
  if (!directUrl) return null;
  setSettingsStatus('שולף ' + label + '...', '');
  try {
    const resp = await fetch(directUrl, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error('Google Drive הציג דף HTML — ייתכן שהקובץ גדול מדי לאישור אוטומטי.');
    const buf = await resp.arrayBuffer();
    if (buf.byteLength < 100) throw new Error('הקובץ שהתקבל ריק — בדוק שהשיתוף מוגדר כ"כל מי שיש לו קישור"');
    return buf;
  } catch(e) {
    console.error('GDrive fetch error:', label, e.message);
    throw e;
  }
}

export async function fetchNow() {
  if (!state.odSettings.soUrl) { setSettingsStatus('אין לינק SO מוגדר', 'err'); return; }
  document.getElementById('spin').style.display = 'inline';
  setSettingsStatus('שולף קבצים...', '');

  withXLSX(async () => {
    let soBuf = null;
    try { soBuf = await fetchFileFromUrl(state.odSettings.soUrl, 'הזמנות פתוחות'); }
    catch(fetchErr) {
      document.getElementById('spin').style.display = 'none';
      setSettingsStatus('שגיאה: ' + fetchErr.message, 'err');
      return;
    }
    if (!soBuf) {
      document.getElementById('spin').style.display = 'none';
      setSettingsStatus('שגיאה בשליפת קובץ SO', 'err');
      return;
    }
    try {
      const wb = XLSX.read(soBuf, { type: 'array', cellDates: true, dense: true });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      state.allRows = parseRows(raw);
      applyOverridesToRows(state.allRows);
      state.soGroups = buildGroups(state.allRows);
      document.getElementById('fbadge').textContent = 'SO · ' + state.allRows.length + ' שורות';
      document.getElementById('upl').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.getElementById('expbtn').style.display = 'inline-flex';
      if (_onDataLoaded) _onDataLoaded('so');
      if (!document.fullscreenElement && window.innerWidth > 768) {
        document.documentElement.requestFullscreen().then(() => { document.getElementById('fsbtn').textContent = '✕'; }).catch(() => {});
      }
    } catch(e) {
      document.getElementById('spin').style.display = 'none';
      setSettingsStatus('שגיאה בפענוח קובץ SO: ' + e.message, 'err');
      return;
    }

    if (state.odSettings.poUrl) {
      const poBuf = await fetchFileFromUrl(state.odSettings.poUrl, 'מעקב רכש').catch(() => null);
      if (poBuf) {
        try {
          const wb2 = XLSX.read(poBuf, { type: 'array', cellDates: true, dense: true });
          const raw2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { defval: '' });
          state.poRows = parsePORows(raw2);
          state.poLoaded = true;
          linkPOtoSO();
          document.getElementById('fbadge-po').style.display = 'inline';
          document.getElementById('fbadge-po').textContent = 'PO · ' + state.poRows.length + ' שורות';
          document.getElementById('supp-nopo').style.display = 'none';
          document.getElementById('supp-content').style.display = 'flex';
          document.getElementById('supp-content').style.flexDirection = 'column';
          if (_onDataLoaded) _onDataLoaded('po');
        } catch(e2) { console.warn('PO parse error:', e2); }
      }
    }

    document.getElementById('spin').style.display = 'none';
    const now = new Date();
    const timeStr = p2(now.getHours()) + ':' + p2(now.getMinutes());
    state.odSettings.lastFetch = now.toISOString();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.odSettings));
    setSettingsStatus('✓ עודכן בהצלחה — ' + timeStr, 'ok');
    document.getElementById('btn-refresh-now').style.display = 'inline-flex';
  });
}
