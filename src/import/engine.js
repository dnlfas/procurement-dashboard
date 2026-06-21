import { state, TODAY, NK } from '../state.js';
import { toast } from '../utils.js';
import { withXLSX } from '../upload.js';
import { buildGroups } from '../parse/so.js';
import { applyOverridesToRows, syncOverrides } from '../persistence.js';
import { renderBoss } from '../views/boss.js';
import { applyFilters } from '../views/employee.js';

const FIELD_LABELS = { tracking: 'מעקב', supplier: 'ספק', poNum: 'PO רכש', custPO: 'PO לקוח', status: 'סטטוס', notes: 'הערה', deliveryDate: 'ת. אספקה' };
const STATUS_HE = { 'ordered':'הוזמן מהספק','waiting_wh':'ממתין במחסן המוצא','in_transit':'נחת בארץ','customs_sub':'הגשות למכס','customs_rel':'שוחרר ממכס','delivery_bts':'בשליחות ל-BTS','qc':'בבקרת איכות','supplied':'סופק ללקוח','partial':'סופק חלקי','waiting_cust':'ממתין לאספקה','cancelled':'בוטל' };

export function openImportModal() {
  state._importFile = null; state._importExcelRows = null;
  document.getElementById('import-ta').value = '';
  document.getElementById('import-file-notes').value = '';
  document.getElementById('import-file-label').textContent = 'לחץ לבחירת קובץ (Excel, PDF, תמונה)';
  document.getElementById('fi-import').value = '';
  document.getElementById('import-err').style.display = 'none';
  importSelectTab('text');
  document.getElementById('import-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('import-ta').focus(), 80);
}

export function closeImportModal() { document.getElementById('import-modal').style.display = 'none'; }

export function importSelectTab(t) {
  state._importTab = t;
  document.getElementById('import-section-text').style.display = t === 'text' ? 'block' : 'none';
  document.getElementById('import-section-file').style.display = t === 'file' ? 'flex' : 'none';
  document.getElementById('import-section-file').style.flexDirection = 'column';
  document.getElementById('import-section-file').style.gap = '10px';
  document.getElementById('import-tab-text').classList.toggle('on', t === 'text');
  document.getElementById('import-tab-file').classList.toggle('on', t === 'file');
}

export function handleImportFile(e) {
  const file = e.target.files[0]; if (!file) return;
  state._importFile = file; state._importExcelRows = null;
  document.getElementById('import-file-label').textContent = '📎 ' + file.name;
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
  if (isXlsx) {
    const reader = new FileReader();
    reader.onload = ev => {
      withXLSX(() => {
        try {
          const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true, dense: true });
          state._importExcelRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          document.getElementById('import-file-label').textContent = '📊 ' + file.name + ' — ' + state._importExcelRows.length + ' שורות';
        } catch(err) { document.getElementById('import-file-label').textContent = '⚠ שגיאה: ' + err.message; }
      });
    };
    reader.readAsArrayBuffer(file);
  }
}

export function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export async function submitImportParse() {
  const btn = document.getElementById('import-submit');
  btn.disabled = true; btn.textContent = 'מנתח...';
  document.getElementById('import-err').style.display = 'none';
  try {
    let body;
    if (state._importTab === 'text') {
      const txt = document.getElementById('import-ta').value.trim();
      if (!txt) { document.getElementById('import-err').textContent = 'אנא הדבק טקסט'; document.getElementById('import-err').style.display = 'block'; return; }
      body = { type: 'text', content: txt };
    } else {
      if (!state._importFile) { document.getElementById('import-err').textContent = 'אנא בחר קובץ'; document.getElementById('import-err').style.display = 'block'; return; }
      const fileNotes = document.getElementById('import-file-notes').value.trim();
      const isXlsx = /\.(xlsx|xls)$/i.test(state._importFile.name);
      if (isXlsx && state._importExcelRows) {
        body = { type: 'excel', content: JSON.stringify(state._importExcelRows), context: fileNotes || undefined };
      } else {
        const isPdf = state._importFile.type === 'application/pdf' || /\.pdf$/i.test(state._importFile.name);
        const b64 = await toBase64(state._importFile);
        body = { type: isPdf ? 'pdf' : 'image', content: b64, mimeType: state._importFile.type || 'image/jpeg', context: fileNotes || undefined };
      }
    }
    const res = await fetch('/api/parse-update', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || 'שגיאה לא ידועה');
    closeImportModal();
    openImportPreview(json.updates || [], json.sourceType || 'other');
  } catch(e) {
    document.getElementById('import-err').textContent = 'שגיאה: ' + e.message;
    document.getElementById('import-err').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = '✨ נתח עם AI';
  }
}

export function matchUpdateToRows(upd) {
  const mpnUp = (upd.mpn || '').trim().toUpperCase();
  const so = (upd.so || '').trim();
  const stripSfx = s => s.replace(/[-_](ND|CT|DKR|TR|T\/R|1|2|3|4|5|6|CT-ND|DKR-ND)$/, '');
  const mpnBase = stripSfx(mpnUp);
  const rowMpn = r => r.mpn.trim().toUpperCase();
  const rowBase = r => stripSfx(rowMpn(r));
  if (so && mpnUp) { const r = state.allRows.find(x => x.so === so && rowMpn(x) === mpnUp); if (r) return [r]; }
  if (mpnUp) { const rs = state.allRows.filter(x => rowMpn(x) === mpnUp); if (rs.length) return rs; }
  if (mpnBase) { const rs = state.allRows.filter(x => rowBase(x) === mpnBase || rowMpn(x) === mpnBase || rowBase(x) === mpnUp); if (rs.length) return rs; }
  if (mpnUp.length >= 5) { const rs = state.allRows.filter(x => { const rm = rowMpn(x); return rm.length >= 5 && (rm.startsWith(mpnUp) || mpnUp.startsWith(rm)); }); if (rs.length) return rs; }
  if (mpnUp.length >= 6) {
    const rs = state.allRows.filter(x => {
      const rm = rowMpn(x);
      if (rm.length < 6) return false;
      const long = rm.length >= mpnUp.length ? rm : mpnUp;
      const short = rm.length >= mpnUp.length ? mpnUp : rm;
      const idx = long.indexOf(short);
      if (idx < 0) return false;
      const before = idx === 0 ? '' : long[idx - 1];
      const after = idx + short.length >= long.length ? '' : long[idx + short.length];
      return (before === '' || /[\s\-]/.test(before)) && (after === '' || /[\s\-]/.test(after));
    });
    if (rs.length) return rs;
  }
  if (upd.poNum) { const rs = state.allRows.filter(x => (x.poNum || state.fieldOvr[x.nk + '__po'] || '') === (upd.poNum || '')); if (rs.length) return rs; }
  if (upd.custPO) { const rs = state.allRows.filter(x => (x.custPO || state.fieldOvr[x.nk + '__custPO'] || '') === (upd.custPO || '')); if (rs.length) return rs; }
  return [];
}

export function openImportPreview(updates, sourceType) {
  if (!updates.length) { toast('ה-AI לא מצא נתונים לעדכון'); return; }
  state._importChanges = [];
  state._importSourceType = sourceType;
  const fieldOrder = ['tracking', 'deliveryDate', 'status', 'supplier', 'poNum', 'custPO', 'notes'];
  updates.forEach(upd => {
    const matched = matchUpdateToRows(upd);
    const qty = parseFloat(upd.qty) || 0;
    const st = upd.status || '';
    const verb = (st === 'supplied' || st === 'partial') ? 'סופק'
      : (['waiting_wh','in_transit','customs_sub','customs_rel','delivery_bts','qc'].includes(st) || upd.tracking) ? 'נשלח'
      : (st === 'ordered') ? 'הוזמן' : 'כמות';
    let candidates;
    if (matched.length >= 1 && qty > 0) {
      const sorted = [...matched].sort((a, b) => {
        const da = a.dd ? a.dd.getTime() : Infinity, db = b.dd ? b.dd.getTime() : Infinity;
        if (da !== db) return da - db;
        return (a.so || '').localeCompare(b.so || '');
      });
      let remaining = qty;
      candidates = [];
      sorted.forEach(row => {
        if (remaining <= 0) return;
        const need = row.qtyR > 0 ? row.qtyR : remaining;
        const alloc = Math.min(remaining, need);
        remaining -= alloc;
        const partial = row.qtyR > 0 && alloc < row.qtyR;
        const allocNote = verb + ' ' + alloc + (row.qtyR > 0 ? '/' + row.qtyR : '') + ' יח׳' + (partial ? ' (חלקי)' : ' (מלא)');
        candidates.push({ row, allocNote, partial });
      });
    } else {
      candidates = (matched.length ? matched : [null]).map(row => ({ row, allocNote: '', partial: false }));
    }
    candidates.forEach(c => {
      const row = c.row;
      fieldOrder.forEach(field => {
        let newVal = upd[field] || '';
        if (field === 'notes') {
          const parts = [];
          if (c.allocNote) parts.push(c.allocNote);
          if (upd.supplierRef) parts.push('הזמנת ספק #' + upd.supplierRef);
          if (upd.notes) parts.push(upd.notes);
          newVal = parts.join(' · ');
        }
        if (field === 'deliveryDate') { if (!newVal || !/^\d{4}-\d{2}-\d{2}$/.test(newVal)) return; }
        if (field === 'status') {
          if (c.partial && (newVal === 'supplied')) newVal = 'partial';
          if (!newVal) return;
          const knownStatuses = new Set(Object.keys(STATUS_HE).concat(['pending','sourcing','qc_supp','cancelled_bts','none']));
          if (!knownStatuses.has(newVal)) return;
          if (sourceType !== 'so_file' && !STATUS_HE[newVal]) return;
        }
        if (!newVal) return;
        if (field === 'poNum' && !/^(PO|פו)/i.test(newVal) && !/^\d{8,}$/.test(newVal)) return;
        if (field === 'custPO') {
          if (sourceType !== 'customer_po' && sourceType !== 'so_file') return;
          if (_currentVal(row, 'custPO')) return;
        }
        const oldVal = _currentVal(row, field);
        if (newVal === oldVal && field !== 'notes') return;
        state._importChanges.push({ upd, row, field, oldVal, newVal, checked: true });
      });
    });
    if (!state._importChanges.find(c => c.upd === upd)) {
      const fallbackRow = matched[0] || null;
      const isNewSO = sourceType === 'so_file' && !fallbackRow;
      state._importChanges.push({ upd, row: fallbackRow, field: '', oldVal: '', newVal: '', checked: isNewSO, empty: true, newSORow: isNewSO });
    }
  });

  // Bulk waiting_wh expansion
  const wwhTrackings = [];
  for (const c of state._importChanges) {
    if (c.field === 'tracking' && c.newVal) {
      const curSt = c.row ? (state.statusOvr[c.row.nk] ?? c.row.status) : null;
      if ((!c.row || curSt === 'waiting_wh') && !wwhTrackings.includes(c.newVal)) wwhTrackings.push(c.newVal);
    }
  }
  if (wwhTrackings.length) {
    const bulkTracking = wwhTrackings[0];
    const coveredNks = new Set(state._importChanges.filter(c => c.row).map(c => c.row.nk));
    for (const row of state.allRows) {
      const curSt = state.statusOvr[row.nk] ?? row.status;
      if (curSt !== 'waiting_wh') continue;
      if (coveredNks.has(row.nk)) continue;
      const oldVal = _currentVal(row, 'tracking');
      if (oldVal === bulkTracking) continue;
      state._importChanges.push({ upd: { tracking: bulkTracking }, row, field: 'tracking', oldVal, newVal: bulkTracking, checked: true, empty: false, wwhBulk: true });
    }
  }

  const srcLabel = { 'shipping_notice':'הודעת משלוח','customer_po':'PO לקוח','invoice':'חשבונית','coc':'תעודת התאמה','so_file':'הזמנת מכירה','other':'מסמך' }[sourceType] || 'מסמך';
  document.getElementById('import-preview-title').textContent = '📋 שינויים מוצעים מ' + srcLabel;
  const realChanges = state._importChanges.filter(c => !c.empty);
  document.getElementById('import-preview-sub').textContent = realChanges.length + ' שינויים ב-' + updates.length + ' פריטים';
  _renderPreviewTable();
  _updateApplyCount();
  document.getElementById('import-preview-modal').style.display = 'flex';
}

export function closeImportPreview() { document.getElementById('import-preview-modal').style.display = 'none'; }

export function _renderPreviewTable() {
  const tbody = document.getElementById('import-preview-body');
  tbody.innerHTML = state._importChanges.map((c, i) => {
    if (c.empty) {
      return `<tr><td></td><td class="import-new">${_esc(c.upd.mpn || c.upd.custPO || c.upd.poNum || '—')}</td><td colspan="4" style="color:var(--txt2);font-size:11px">אין שינויים לעדכון</td></tr>`;
    }
    const sectionHdr = (c.wwhBulk && (i === 0 || !state._importChanges[i - 1].wwhBulk))
      ? `<tr><td colspan="6" style="padding:5px 8px;font-size:11px;color:var(--txt2);background:var(--sur2);border-top:1px solid var(--bdr)">📦 הזמנות נוספות ממתינות במחסן המוצא — עדכון מספר מעקב DHL</td></tr>` : '';
    const rowLabel = c.row ? c.row.so : '—';
    const mpnLabel = c.row ? c.row.mpn : (c.upd.mpn || c.upd.custPO || c.upd.poNum || '—');
    const trunc = v => v.length > 70 ? v.slice(0, 68) + '…' : v;
    const newRaw = c.field === 'status' ? (STATUS_HE[c.newVal] || c.newVal) : c.newVal;
    const newDisp = trunc(newRaw);
    const oldDisp = c.field === 'status' ? (STATUS_HE[c.oldVal] || c.oldVal || '—') : trunc(c.oldVal || '—');
    const unmatch = !c.row ? `<span class="import-unmatched">לא נמצאה הזמנה</span>` : '';
    return sectionHdr + `<tr>
      <td><input type="checkbox" data-idx="${i}" ${c.checked ? 'checked' : ''} onchange="importChkChange(${i},this.checked)"></td>
      <td class="import-new">${_esc(mpnLabel)}</td>
      <td style="font-size:11px;color:var(--txt2)">${_esc(rowLabel)}${unmatch}</td>
      <td>${_esc(FIELD_LABELS[c.field] || c.field)}</td>
      <td><span class="import-old">${_esc(oldDisp)}</span></td>
      <td class="import-new" title="${_esc(newRaw)}">${_esc(newDisp)}</td>
    </tr>`;
  }).join('');
}

export function importChkChange(idx, val) { state._importChanges[idx].checked = val; _updateApplyCount(); }
export function importToggleAll(val) { state._importChanges.forEach(c => c.checked = val); _renderPreviewTable(); _updateApplyCount(); }
export function _updateApplyCount() {
  const n = state._importChanges.filter(c => c.checked && !c.empty && c.row).length;
  const unmatched = state._importChanges.filter(c => c.checked && !c.empty && !c.row);
  const nuCustPO = new Set(unmatched.filter(c => c.upd.custPO && !c.newSORow).map(c => c.upd.custPO)).size;
  const nuNewSO = new Set(state._importChanges.filter(c => c.checked && c.newSORow && c.upd.so).map(c => c.upd.so)).size;
  const nuOther = unmatched.filter(c => !c.upd.custPO && !c.newSORow).length;
  let txt = n + ' שינויים לביצוע';
  if (nuCustPO) {
    const custNames = [...new Set(unmatched.filter(c => c.upd.custPO && c.upd.customer && !c.newSORow).map(c => c.upd.customer))];
    txt += ' + ' + nuCustPO + ' הזמנה' + (nuCustPO > 1 ? 'ות' : '') + ' זמניות ייווצרו' + (custNames.length ? ' (' + custNames.join(', ') + ')' : '');
  }
  if (nuNewSO) txt += ' + ' + nuNewSO + ' הזמנ' + (nuNewSO > 1 ? 'אות' : 'ה') + ' SO חדשות שאינן במערכת';
  if (nuOther) txt += ' + ' + nuOther + ' ממתינים';
  document.getElementById('import-apply-count').textContent = txt;
}

export function applyImportChanges() {
  const toApply = state._importChanges.filter(c => c.checked && !c.empty);
  let count = 0;
  toApply.forEach(c => {
    const { row, field, newVal } = c;
    if (row) {
      const nk = row.nk;
      if (field === 'tracking') {
        state.fieldOvr[nk + '__tracking'] = newVal;
        if (!state.statusOvr[nk] || state.statusOvr[nk] === 'ordered' || state.statusOvr[nk] === 'waiting_wh' || row.status === 'waiting_wh') { state.statusOvr[nk] = 'delivery_bts'; row.status = 'delivery_bts'; }
        row.tracking = newVal; row.cov = 'green';
      } else if (field === 'deliveryDate') {
        state.fieldOvr[nk + '__dd'] = newVal;
        const d = new Date(newVal);
        if (!isNaN(d)) { row.dd = d; row.isOvr = d < TODAY; row.daysOvr = row.isOvr ? Math.floor((TODAY - d) / 86400000) : 0; }
      } else if (field === 'supplier') {
        state.fieldOvr[nk + '__supp'] = newVal; row.supplier = newVal;
      } else if (field === 'poNum') {
        state.fieldOvr[nk + '__po'] = newVal; row.poNum = newVal; if (row.cov !== 'green') row.cov = 'green';
      } else if (field === 'custPO') {
        state.fieldOvr[nk + '__custPO'] = newVal; row.custPO = newVal;
      } else if (field === 'status') {
        state.statusOvr[nk] = newVal; row.status = newVal;
        const greenSt = ['ordered','in_transit','waiting_wh','customs_rel','delivery_bts','qc','supplied','waiting_cust'];
        if (greenSt.includes(newVal)) row.cov = 'green';
        else if (newVal === 'none' || newVal === 'cancelled' || newVal === 'cancelled_bts') row.cov = row.isOvr ? 'red' : 'grey';
        else row.cov = 'orange';
      } else if (field === 'notes') {
        let lines = (state.notes[nk] || '').split('\n').filter(Boolean);
        const token = c.upd.tracking || c.upd.supplierRef || '';
        if (token) lines = lines.filter(l => !l.includes(token));
        if (!lines.includes(newVal)) lines.push(newVal);
        state.notes[nk] = lines.join('\n');
      }
      count++;
    } else if (c.upd.custPO) {
      state.pendingCustPOs[c.upd.custPO] = c.upd;
      count++;
    }
  });

  // Create temp SO entries
  const unmatchedByCustPO = new Map();
  toApply.forEach(c => { if (!c.row && c.upd.custPO) unmatchedByCustPO.set(c.upd.custPO, (unmatchedByCustPO.get(c.upd.custPO) || new Set()).add(c.upd)); });
  if (unmatchedByCustPO.size) {
    const tempOrders = JSON.parse(localStorage.getItem('oo_temp_orders') || '{}');
    const custPOtoTSO = {};
    Object.entries(tempOrders).forEach(([tso, e]) => { custPOtoTSO[e.custPO] = tso; });
    unmatchedByCustPO.forEach((updSet, custPO) => {
      const tso = custPOtoTSO[custPO] || _genTempSO();
      if (!tempOrders[tso]) tempOrders[tso] = { custPO, customer: ([...updSet][0].customer || ''), lines: [] };
      updSet.forEach(upd => {
        if (!tempOrders[tso].lines.find(l => l.mpn === upd.mpn))
          tempOrders[tso].lines.push({ mpn: upd.mpn || '', qty: upd.qty || '', poNum: upd.poNum || '', supplier: upd.supplier || '', notes: upd.notes || '', deliveryDate: upd.deliveryDate || '' });
      });
    });
    try { localStorage.setItem('oo_temp_orders', JSON.stringify(tempOrders)); } catch(e) {}
    injectTempOrders();
  }

  try { localStorage.setItem('oo_fields', JSON.stringify(state.fieldOvr)); } catch(e) {}
  try { localStorage.setItem('oo_status', JSON.stringify(state.statusOvr)); } catch(e) {}
  try { localStorage.setItem(NK, JSON.stringify(state.notes)); } catch(e) {}
  try { localStorage.setItem('oo_pending_cpo', JSON.stringify(state.pendingCustPOs)); } catch(e) {}

  if (state._importSourceType === 'so_file') {
    let soImps; try { soImps = JSON.parse(localStorage.getItem('oo_so_imports') || '{}'); } catch(e) { soImps = {}; }
    let tempOrders; try { tempOrders = JSON.parse(localStorage.getItem('oo_temp_orders') || '{}'); } catch(e) { tempOrders = {}; }
    let soImpChanged = false, tmpChanged = false;
    state._importChanges.forEach(c => {
      const so = c.upd.so, mpn = c.upd.mpn;
      if (!so || so.startsWith('TMP-') || !mpn) return;
      if (!soImps[so]) soImps[so] = { custPO: c.upd.custPO || '', customer: c.upd.customer || '', lines: [] };
      if (c.upd.custPO) soImps[so].custPO = c.upd.custPO;
      if (c.upd.customer) soImps[so].customer = c.upd.customer;
      const existLine = soImps[so].lines.find(l => l.mpn === mpn);
      const ld = { mpn, qty: c.upd.qty || '', deliveryDate: c.upd.deliveryDate || '', poNum: c.upd.poNum || '', supplier: c.upd.supplier || '', notes: c.upd.notes || '', status: c.upd.status || 'ordered' };
      if (existLine) Object.assign(existLine, ld); else soImps[so].lines.push(ld);
      soImpChanged = true;
      if (c.upd.custPO) {
        Object.keys(tempOrders).forEach(tso => { if (tempOrders[tso].custPO === c.upd.custPO) { delete tempOrders[tso]; tmpChanged = true; } });
      }
    });
    if (soImpChanged) try { localStorage.setItem('oo_so_imports', JSON.stringify(soImps)); } catch(e) {}
    if (tmpChanged) try { localStorage.setItem('oo_temp_orders', JSON.stringify(tempOrders)); } catch(e) {}
    injectTempOrders();
    injectSOImports();
  }

  applyOverridesToRows(state.allRows);
  state.soGroups = buildGroups(state.allRows);
  applyFilters();
  renderBoss();
  syncOverrides();
  updateImportBadge();
  closeImportPreview();
  toast('✓ ' + count + ' שינויים הוחלו');
}

export function applyPendingCustPOs() {
  const pending = JSON.parse(localStorage.getItem('oo_pending_cpo') || '{}');
  if (!Object.keys(pending).length) return;
  let changed = false;
  const matchedCustPOs = new Set();
  state.allRows.forEach(r => {
    const p = pending[r.custPO];
    if (!p) return;
    if (p.supplier && state.fieldOvr[r.nk + '__supp'] === undefined) { state.fieldOvr[r.nk + '__supp'] = p.supplier; r.supplier = p.supplier; changed = true; }
    if (p.poNum && state.fieldOvr[r.nk + '__po'] === undefined) { state.fieldOvr[r.nk + '__po'] = p.poNum; r.poNum = p.poNum; changed = true; }
    if (p.tracking && state.fieldOvr[r.nk + '__tracking'] === undefined) { state.fieldOvr[r.nk + '__tracking'] = p.tracking; r.tracking = p.tracking; if (!state.statusOvr[r.nk]) state.statusOvr[r.nk] = 'delivery_bts'; changed = true; }
    if (p.notes && !state.notes[r.nk]) { state.notes[r.nk] = p.notes; changed = true; }
    matchedCustPOs.add(r.custPO);
    delete pending[r.custPO];
    delete state.pendingCustPOs[r.custPO];
  });
  if (matchedCustPOs.size) {
    const tempOrders = JSON.parse(localStorage.getItem('oo_temp_orders') || '{}');
    let tempChanged = false;
    Object.keys(tempOrders).forEach(tso => { if (matchedCustPOs.has(tempOrders[tso].custPO)) { delete tempOrders[tso]; tempChanged = true; } });
    if (tempChanged) try { localStorage.setItem('oo_temp_orders', JSON.stringify(tempOrders)); } catch(e) {}
    let soImps; try { soImps = JSON.parse(localStorage.getItem('oo_so_imports') || '{}'); } catch(e) { soImps = {}; }
    let soImpChanged = false;
    Object.keys(soImps).forEach(so => { if (matchedCustPOs.has(soImps[so].custPO)) { delete soImps[so]; soImpChanged = true; } });
    if (soImpChanged) try { localStorage.setItem('oo_so_imports', JSON.stringify(soImps)); } catch(e) {}
  }
  if (changed) {
    try { localStorage.setItem('oo_fields', JSON.stringify(state.fieldOvr)); } catch(e) {}
    try { localStorage.setItem('oo_status', JSON.stringify(state.statusOvr)); } catch(e) {}
    try { localStorage.setItem(NK, JSON.stringify(state.notes)); } catch(e) {}
    localStorage.setItem('oo_pending_cpo', JSON.stringify(pending));
    syncOverrides();
  }
  updateImportBadge();
}

export function _genTempSO() {
  const t = new Date();
  const d = t.getFullYear().toString() + String(t.getMonth() + 1).padStart(2, '0') + String(t.getDate()).padStart(2, '0');
  let ctr = JSON.parse(localStorage.getItem('oo_temp_ctr') || '{}');
  if (ctr.date !== d) ctr = { date: d, n: 0 };
  ctr.n++;
  try { localStorage.setItem('oo_temp_ctr', JSON.stringify(ctr)); } catch(e) {}
  return 'TMP-' + d + '-' + ctr.n;
}

export function injectTempOrders() {
  const tempOrders = JSON.parse(localStorage.getItem('oo_temp_orders') || '{}');
  if (!Object.keys(tempOrders).length) return;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  Object.entries(tempOrders).forEach(([tso, entry]) => {
    (entry.lines || []).forEach(line => {
      const dd = line.deliveryDate ? new Date(line.deliveryDate) : null;
      const isOvr = !!(dd && dd < now);
      state.allRows.push({
        so: tso, mpn: line.mpn || '', customer: entry.customer || '', custPO: entry.custPO || '',
        poNum: line.poNum || '', supplier: line.supplier || '',
        statusRaw: 'ממתין לטיפול', status: 'pending',
        qtyO: parseFloat(line.qty) || 0, qtyR: parseFloat(line.qty) || 0,
        dd, cov: 'orange', daysOvr: isOvr ? Math.ceil((now - dd) / 86400000) : 0,
        isOvr, nk: tso + '__' + (line.mpn || ''), isTemp: true
      });
    });
  });
  state.soGroups = buildGroups(state.allRows);
}

export function injectSOImports() {
  let soImps;
  try { soImps = JSON.parse(localStorage.getItem('oo_so_imports') || '{}'); } catch(e) { soImps = {}; }
  if (!Object.keys(soImps).length) return;
  const existingNKs = new Set(state.allRows.filter(r => !r.isSOImport).map(r => r.nk));
  const now = new Date(); now.setHours(0, 0, 0, 0);
  state.allRows = state.allRows.filter(r => !r.isSOImport);
  Object.entries(soImps).forEach(([so, entry]) => {
    (entry.lines || []).forEach(line => {
      const nk = so + '__' + (line.mpn || '');
      if (existingNKs.has(nk)) return;
      const dd = line.deliveryDate ? new Date(line.deliveryDate) : null;
      const isOvr = !!(dd && dd < now);
      state.allRows.push({
        so, mpn: line.mpn || '', customer: entry.customer || '', custPO: entry.custPO || '',
        poNum: line.poNum || '', supplier: line.supplier || '',
        statusRaw: line.status || 'ordered', status: line.status || 'ordered',
        qtyO: parseFloat(line.qty) || 0, qtyR: parseFloat(line.qty) || 0,
        dd, cov: 'green', daysOvr: isOvr && dd ? Math.ceil((now - dd) / 86400000) : 0,
        isOvr, nk, isSOImport: true
      });
    });
  });
  state.soGroups = buildGroups(state.allRows);
}

export function updateImportBadge() {
  const n = Object.keys(state.pendingCustPOs).length;
  const el = document.getElementById('import-pending-badge');
  if (!el) return;
  if (n > 0) { el.textContent = n; el.style.display = 'inline'; } else { el.style.display = 'none'; }
}

function _currentVal(row, field) {
  if (!row) return '';
  if (field === 'tracking') return state.fieldOvr[row.nk + '__tracking'] || row.tracking || '';
  if (field === 'supplier') return state.fieldOvr[row.nk + '__supp'] || row.supplier || '';
  if (field === 'poNum') return state.fieldOvr[row.nk + '__po'] || row.poNum || '';
  if (field === 'custPO') return state.fieldOvr[row.nk + '__custPO'] || row.custPO || '';
  if (field === 'status') return state.statusOvr[row.nk] || row.status || 'none';
  if (field === 'notes') return state.notes[row.nk] || '';
  if (field === 'deliveryDate') {
    const ddOvr = state.fieldOvr[row.nk + '__dd'];
    if (ddOvr) return ddOvr;
    if (row.dd instanceof Date && !isNaN(row.dd)) return row.dd.toISOString().slice(0, 10);
    return '';
  }
  return '';
}

function _esc(v) { return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
