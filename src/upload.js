import { state, TODAY, SETTINGS_KEY } from './state.js';
import { toast } from './utils.js';
import { parseRows, buildGroups } from './parse/so.js';
import { parsePORows, linkPOtoSO } from './parse/po.js';
import { applyOverridesToRows } from './persistence.js';

// Callbacks set by main.js
let _onSOLoaded = null;
let _onPOLoaded = null;
export function setUploadCallbacks(onSO, onPO) { _onSOLoaded = onSO; _onPOLoaded = onPO; }

export function withXLSX(cb) {
  if (state.xlsxReady) { cb(); return; }
  state.xlsxQ.push(cb);
  if (state.xlsxQ.length > 1) return;
  const sc = document.createElement('script');
  sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  sc.onload = () => { state.xlsxReady = true; state.xlsxQ.forEach(f => f()); state.xlsxQ = []; };
  sc.onerror = () => toast('שגיאה: בדוק חיבור אינטרנט');
  document.head.appendChild(sc);
}

export function trigUp() { document.getElementById('fi').click(); }
export function trigUpPO() { document.getElementById('fi-po').click(); }

export function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropz')?.classList.remove('dov');
  if (e.dataTransfer.files[0]) startParse(e.dataTransfer.files[0]);
}

export function handleFile(e) {
  if (e.target.files[0]) loadWizFile(e.target.files[0], 'so');
}
export function handleFilePO(e) {
  if (e.target.files[0]) loadWizFile(e.target.files[0], 'po');
}

export function startParse(file) {
  document.getElementById('spin').style.display = 'inline';
  withXLSX(() => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true, dense: true });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        state.allRows = parseRows(raw);
        applyOverridesToRows(state.allRows);
        state.soGroups = buildGroups(state.allRows);
        if (_onSOLoaded) _onSOLoaded(file.name);
      } catch(err) {
        document.getElementById('spin').style.display = 'none';
        toast('שגיאה: ' + err.message);
      }
    };
    r.readAsArrayBuffer(file);
  });
}

export function startParsePO(file) {
  document.getElementById('spin').style.display = 'inline';
  withXLSX(() => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true, dense: true });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        state.poRows = parsePORows(raw);
        state.poLoaded = true;
        document.getElementById('spin').style.display = 'none';
        const fpoBadge = document.getElementById('fbadge-po');
        if (fpoBadge) { fpoBadge.style.display = 'inline'; fpoBadge.textContent = file.name + ' · ' + state.poRows.length + ' שורות PO'; }
        if (_onPOLoaded) _onPOLoaded();
      } catch(err) {
        document.getElementById('spin').style.display = 'none';
        toast('שגיאה PO: ' + err.message);
      }
    };
    r.readAsArrayBuffer(file);
  });
}

export function handleSupplierFile(e) {
  if (!e.target.files[0]) return;
  const file = e.target.files[0];
  document.getElementById('spin').style.display = 'inline';
  withXLSX(() => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true, dense: true });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        // parsePOFile is in parse/po.js but this old supplier-file path uses a different format
        // We import it lazily
        import('./parse/po.js').then(({ parsePOFile }) => {
          state.poData = parsePOFile(raw);
          document.getElementById('spin').style.display = 'none';
          document.getElementById('suppbadge').style.display = 'inline';
          document.getElementById('suppbadge').textContent = file.name + ' · ' + state.poData.length + ' שורות';
          if (_onSOLoaded) _onSOLoaded(null); // re-render
          toast('✓ קובץ ספקים נטען');
        });
      } catch(err) {
        document.getElementById('spin').style.display = 'none';
        toast('שגיאה בקובץ ספקים: ' + err.message);
      }
    };
    r.readAsArrayBuffer(file);
  });
}

export async function handleTopbarUpload(e, type) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const statusEl = document.getElementById('upload-status');
  const showStatus = (msg, color) => {
    statusEl.style.display = 'inline';
    statusEl.style.color = color || 'var(--txt2)';
    statusEl.textContent = msg;
  };

  showStatus('קורא קובץ...', 'var(--acc)');
  document.getElementById('spin').style.display = 'inline';

  try {
    const buf = await file.arrayBuffer();
    showStatus('מעלה...', 'var(--acc)');
    const res = await fetch(`/api/upload?type=${type}`, {
      method: 'POST',
      body: buf,
      headers: { 'Content-Type': 'application/octet-stream' }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = (err.error || '').includes('token') ? 'Blob store לא מחובר ב-Vercel' : ('שגיאה: ' + (err.error || res.status));
      showStatus(msg, 'var(--red)');
      document.getElementById('spin').style.display = 'none';
      setTimeout(() => { statusEl.style.display = 'none'; }, 6000);
      return;
    }
    const { url } = await res.json();
    if (type === 'so') state.odSettings.soUrl = url;
    else state.odSettings.poUrl = url;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.odSettings));
    showStatus('מעבד...', 'var(--acc)');
    withXLSX(() => {
      try {
        const wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: true });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (type === 'so') {
          state.allRows = parseRows(raw);
          applyOverridesToRows(state.allRows);
          state.soGroups = buildGroups(state.allRows);
          if (state.poLoaded) linkPOtoSO();
          if (_onSOLoaded) _onSOLoaded(null);
          showStatus('✓ SO עודכן — ' + state.allRows.length + ' שורות', 'var(--grn)');
        } else {
          state.poRows = parsePORows(raw);
          state.poLoaded = true;
          linkPOtoSO();
          if (_onPOLoaded) _onPOLoaded();
          showStatus('✓ PO עודכן — ' + state.poRows.length + ' שורות', 'var(--grn)');
        }
        document.getElementById('spin').style.display = 'none';
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
      } catch(parseErr) {
        showStatus('שגיאה בפענוח: ' + parseErr.message, 'var(--red)');
        document.getElementById('spin').style.display = 'none';
      }
    });
  } catch(err) {
    showStatus('שגיאה: ' + err.message, 'var(--red)');
    document.getElementById('spin').style.display = 'none';
  }
}

// Wizard file loader (shared by handleFile/handleFilePO in wizard context)
export function loadWizFile(file, type) {
  const card = document.getElementById('wiz-' + type);
  const status = document.getElementById('wiz-' + type + '-status');
  const num = document.getElementById('wiz-' + type + '-num');
  if (!card) { startParse(file); return; }
  status.textContent = 'טוען...';
  withXLSX(() => {
    const r = new FileReader();
    r.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true, dense: true });
        const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        if (type === 'so') {
          state.wizSOFile = { name: file.name, raw };
        } else {
          state.wizPOFile = { name: file.name, raw };
        }
        card.classList.add('wiz-loaded');
        num.textContent = '✓';
        status.textContent = file.name + ' · ' + raw.length + ' שורות';
        document.getElementById('wiz-launch').style.display = state.wizSOFile ? 'inline-flex' : 'none';
      } catch(err) {
        status.textContent = 'שגיאה: ' + err.message;
        card.classList.remove('wiz-loaded');
      }
    };
    r.readAsArrayBuffer(file);
  });
}
