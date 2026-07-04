import { state, NK } from './state.js';
import { toast, autoH } from './utils.js';
import { _trackingUrl } from './views/employee.js';

// Callback set by main.js to avoid circular imports
let _refreshCallback = null;
export function setRefreshCallback(fn) { _refreshCallback = fn; }

export function syncOverrides() {
  clearTimeout(state._syncTimer);
  state._syncTimer = setTimeout(function() {
    let tempOrders = {}, soImports = {}, pendingCPO = [];
    try { tempOrders = JSON.parse(localStorage.getItem('oo_temp_orders') || '{}'); } catch(e) {}
    try { soImports = JSON.parse(localStorage.getItem('oo_so_imports') || '{}'); } catch(e) {}
    try { pendingCPO = JSON.parse(localStorage.getItem('oo_pending_cpo') || '[]'); } catch(e) {}
    const payload = JSON.stringify({
      fieldOvr: state.fieldOvr,
      statusOvr: state.statusOvr,
      notes: state.notes,
      pullOrders: state.pullOrders,
      tempOrders, soImports, pendingCPO
    });
    fetch('/api/overrides', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' } }).catch(function() {});
  }, 1200);
}

export async function loadOverridesFromBlob() {
  try {
    const res = await fetch('/api/overrides');
    if (!res.ok) return;
    const d = await res.json();
    if (d.fieldOvr) { Object.assign(state.fieldOvr, d.fieldOvr); localStorage.setItem('oo_fields', JSON.stringify(state.fieldOvr)); }
    if (d.statusOvr) { Object.assign(state.statusOvr, d.statusOvr); localStorage.setItem('oo_status', JSON.stringify(state.statusOvr)); }
    if (d.notes) { Object.assign(state.notes, d.notes); localStorage.setItem(NK, JSON.stringify(state.notes)); }
    if (d.pullOrders) { Object.assign(state.pullOrders, d.pullOrders); localStorage.setItem('oo_pull', JSON.stringify(state.pullOrders)); }
    if (d.tempOrders && Object.keys(d.tempOrders).length) { localStorage.setItem('oo_temp_orders', JSON.stringify(d.tempOrders)); }
    if (d.soImports && Object.keys(d.soImports).length) { localStorage.setItem('oo_so_imports', JSON.stringify(d.soImports)); }
    if (d.pendingCPO && d.pendingCPO.length) { localStorage.setItem('oo_pending_cpo', JSON.stringify(d.pendingCPO)); }
    cleanupNotes();
    if (state.allRows.length && _refreshCallback) _refreshCallback();
  } catch(e) {}
}

export function applyOverridesToRows(rows) {
  rows.forEach(function(row) {
    const suppOvr = state.fieldOvr[row.nk + '__supp'];
    const poOvr = state.fieldOvr[row.nk + '__po'];
    const trackOvr = state.fieldOvr[row.nk + '__tracking'];
    const custPOOvr = state.fieldOvr[row.nk + '__custPO'];
    const ddOvr = state.fieldOvr[row.nk + '__dd'];
    const stOvr = state.statusOvr[row.nk];
    if (suppOvr !== undefined) row.supplier = suppOvr;
    if (poOvr !== undefined) {
      row.poNum = poOvr;
      if (poOvr && row.cov !== 'green') row.cov = 'green';
      else if (!poOvr) row.cov = row.qtyR === 0 ? 'grey' : row.isOvr ? 'red' : 'orange';
    }
    if (trackOvr) row.tracking = trackOvr;
    if (custPOOvr !== undefined) row.custPO = custPOOvr;
    if (ddOvr) {
      const d = new Date(ddOvr);
      if (!isNaN(d)) { row.dd = d; row.isOvr = d < TODAY_REF(); row.daysOvr = row.isOvr ? Math.floor((TODAY_REF() - d) / 86400000) : 0; }
    }
    row.isPull = !!(row.custPO && state.pullOrders[row.custPO]);
    if (stOvr !== undefined) {
      row.status = stOvr;
      if (['ordered','in_transit','waiting_wh','customs_rel','delivery_bts','qc','supplied','waiting_cust'].includes(stOvr)) row.cov = 'green';
      else if (stOvr === 'none' || stOvr === 'cancelled' || stOvr === 'cancelled_bts') row.cov = row.isOvr ? 'red' : 'grey';
      else row.cov = 'orange';
    }
  });
}

// Lazy TODAY ref to avoid importing from state (state imports nothing)
function TODAY_REF() {
  return new Date(2026, 4, 19);
}

export function saveField(inp) {
  const key = inp.dataset.key + '__' + inp.dataset.field;
  const val = inp.value.trim();
  if (val) state.fieldOvr[key] = val; else delete state.fieldOvr[key];
  inp.classList.toggle('has-ovr', !!state.fieldOvr[inp.dataset.key + '__' + inp.dataset.field]);
  const row = state.allRows.find(r => r.nk === inp.dataset.key);
  if (row) {
    if (inp.dataset.field === 'supp') row.supplier = val || row.supplier;
    if (inp.dataset.field === 'po') {
      row.poNum = val;
      if (val && row.cov !== 'green') row.cov = 'green';
      else if (!val && row.status === 'none') row.cov = row.isOvr ? 'red' : 'grey';
    }
    if (inp.dataset.field === 'tracking') {
      const url = _trackingUrl(val);
      let a = inp.parentElement.querySelector('a');
      if (url) {
        if (!a) {
          a = document.createElement('a');
          a.target = '_blank';
          a.rel = 'noopener';
          a.title = 'עקוב אחר המשלוח';
          a.style.cssText = 'color:var(--acc);font-size:14px;text-decoration:none;flex-shrink:0;line-height:1';
          a.textContent = '🔗';
          inp.parentElement.appendChild(a);
        }
        a.href = url;
      } else if (a) {
        a.remove();
      }
    }
    if (inp.dataset.field === 'tracking' && val) {
      state.statusOvr[row.nk] = 'delivery_bts';
      row.status = 'delivery_bts';
      row.cov = 'green';
      localStorage.setItem('oo_status', JSON.stringify(state.statusOvr));
      const sel = inp.closest('tr')?.querySelector('.stat-sel');
      if (sel) { sel.value = 'delivery_bts'; sel.className = 'stat-sel s-ord'; }
    }
  }
  try { localStorage.setItem('oo_fields', JSON.stringify(state.fieldOvr)); } catch(e) {}
  syncOverrides();
  const labels = { supp: 'ספק', po: 'PO', tracking: 'מעקב' };
  toast('✓ ' + (labels[inp.dataset.field] || inp.dataset.field) + ' עודכן' + (inp.dataset.field === 'tracking' && val ? ' — סטטוס עודכן לבשליחות ל-BTS' : ''));
}

export function saveStatus(sel) {
  const key = sel.dataset.key, val = sel.value;
  const CM = { 'none':'s-non','pending':'s-pnd','sourcing':'s-pnd','ordered':'s-ord','waiting_wh':'s-ord','in_transit':'s-ord','customs_sub':'s-pnd','customs_rel':'s-ord','delivery_bts':'s-ord','qc_supp':'s-qc','qc':'s-qc','supplied':'s-grn','partial':'s-pnd','waiting_cust':'s-pnd','cancelled':'s-can','cancelled_bts':'s-can' };
  sel.className = 'stat-sel ' + (CM[val] || 's-non');
  if (val === 'none') delete state.statusOvr[key]; else state.statusOvr[key] = val;
  try { localStorage.setItem('oo_status', JSON.stringify(state.statusOvr)); } catch(e) {}
  syncOverrides();
  const row = state.allRows.find(r => r.nk === key);
  if (row) {
    row.status = val === 'none' ? 'none' : val;
    if (['ordered','in_transit','waiting_wh','customs_rel','delivery_bts','qc','supplied','waiting_cust'].includes(val)) row.cov = 'green';
    else if (val === 'none' || val === 'cancelled' || val === 'cancelled_bts') row.cov = row.isOvr ? 'red' : 'grey';
    else row.cov = 'orange';
  }
  toast('✓ סטטוס עודכן');
}

export function saveNote(el) {
  const key = el.dataset.key, val = el.value.trim();
  if (val) state.notes[key] = val; else delete state.notes[key];
  el.classList.toggle('hn', !!val);
  try { localStorage.setItem(NK, JSON.stringify(state.notes)); } catch(e) {}
  syncOverrides();
  toast('✓ הערה נשמרה');
}

export function cleanupNotes() {
  const TOKEN_RE = /(?:(?:AWB|#)\s*)([A-Z0-9]{5,})|(\b\d{10,}\b)/i;
  const tokenOf = l => { const m = l.match(TOKEN_RE); return m ? (m[1] || m[2]).toUpperCase() : null; };
  let changed = 0;
  Object.keys(state.notes).forEach(nk => {
    const lines = (state.notes[nk] || '').split('\n').filter(Boolean);
    if (lines.length <= 1) return;
    const tokenLast = {}, exactLast = {};
    lines.forEach((l, i) => { const t = tokenOf(l); if (t) tokenLast[t] = i; else exactLast[l] = i; });
    const cleaned = lines.filter((l, i) => { const t = tokenOf(l); return t ? tokenLast[t] === i : exactLast[l] === i; });
    if (cleaned.length !== lines.length) { state.notes[nk] = cleaned.join('\n'); changed++; }
  });
  if (changed) { try { localStorage.setItem(NK, JSON.stringify(state.notes)); } catch(e) {} syncOverrides(); }
  return changed;
}

export function exportNotes() {
  const lines = [['הזמנה', 'פריט', 'הערה']];
  Object.entries(state.notes).forEach(([k, v]) => { const p = k.split('__'); lines.push([p[0], p[1] || '(הזמנה)', v]); });
  if (lines.length === 1) { toast('אין הערות לייצוא'); return; }
  const csv = lines.map(l => l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = 'הערות_מעקב.csv';
  a.click();
  toast('✓ הערות יוצאו');
}
