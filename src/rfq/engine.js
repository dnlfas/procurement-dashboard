import { state, RFQ_KEY } from '../state.js';
import { p2 } from '../utils.js';

export function rfqUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

export function rfqDeadline(rec) { return rec.receivedAt + 48 * 3600 * 1000; }

export function rfqCountdown(rec) {
  const now = Date.now();
  const dl = rfqDeadline(rec);
  const open = rec.status === 'new' || rec.status === 'in_progress';
  if (!open) return { label: '', cls: 'cd-x' };
  const diff = dl - now;
  if (diff < 0) {
    const h = Math.round(-diff / 3600000);
    return { label: 'פג תוקף לפני ' + h + 'ש\'', cls: 'cd-r' };
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const label = 'נותרו ' + h + 'ש\' ' + m + 'ד\'';
  if (diff < 12 * 3600000) return { label, cls: 'cd-o' };
  return { label, cls: 'cd-g' };
}

export function rfqUrgencyClass(rec) {
  const open = rec.status === 'new' || rec.status === 'in_progress';
  if (!open) return 'rfq-done';
  const diff = rfqDeadline(rec) - Date.now();
  if (diff < 0) return 'rfq-overdue';
  if (diff < 12 * 3600000) return 'rfq-urgent';
  return 'rfq-open';
}

export function rfqUrgencyDot(rec) {
  const open = rec.status === 'new' || rec.status === 'in_progress';
  if (!open) return '<span class="stl tl-x"></span>';
  const diff = rfqDeadline(rec) - Date.now();
  if (diff < 0) return '<span class="stl tl-r"></span>';
  if (diff < 12 * 3600000) return '<span class="stl tl-o"></span>';
  return '<span class="stl tl-g"></span>';
}

export function rfqStatusBadge(status) {
  const map = { new: '<span class="badge b-a">חדש</span>', in_progress: '<span class="badge b-o">בטיפול</span>', sent: '<span class="badge b-g">נשלח</span>', closed: '<span class="badge b-x">סגור</span>', cancelled: '<span class="badge b-x">בוטל</span>' };
  return map[status] || '';
}

export function fmtDT(ts) {
  const d = new Date(ts);
  return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

export function rfqSortKey(rec) {
  const open = rec.status === 'new' || rec.status === 'in_progress';
  if (!open) return 1e15 + rec.receivedAt;
  const diff = rfqDeadline(rec) - Date.now();
  return diff < 0 ? diff - 1e12 : diff;
}

// RFQs live in localStorage and are mirrored to the server (/api/overrides?doc=rfq).
// Each record carries updatedAt; deleted ids are kept as tombstones so a delete on one device sticks on others.
const RFQ_DEL_KEY = 'oo_rfq_deleted';
let _rfqSyncTimer = null;

function loadDeleted() {
  try { return JSON.parse(localStorage.getItem(RFQ_DEL_KEY) || '[]'); } catch(e) { return []; }
}

function pushRFQ() {
  clearTimeout(_rfqSyncTimer);
  _rfqSyncTimer = setTimeout(() => {
    const payload = JSON.stringify({ items: state.rfqData, deleted: loadDeleted() });
    fetch('/api/overrides?doc=rfq', { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  }, 1200);
}

export function saveRFQ() {
  try { localStorage.setItem(RFQ_KEY, JSON.stringify(state.rfqData)); } catch(e) {}
  pushRFQ();
}

function touch(rec) { rec.updatedAt = Date.now(); }

export async function loadRFQFromServer() {
  try {
    const res = await fetch('/api/overrides?doc=rfq');
    if (!res.ok) return;
    const d = await res.json();
    const deleted = new Set([...loadDeleted(), ...(d.deleted || [])]);
    const byId = new Map();
    const ver = r => r.updatedAt || r.receivedAt || 0;
    [...(d.items || []), ...state.rfqData].forEach(r => {
      if (deleted.has(r.id)) return;
      const cur = byId.get(r.id);
      if (!cur || ver(r) > ver(cur)) byId.set(r.id, r);
    });
    const merged = [...byId.values()].sort((a, b) => b.receivedAt - a.receivedAt);
    const serverIds = (d.items || []).map(r => r.id + ':' + ver(r)).sort().join();
    const mergedIds = merged.map(r => r.id + ':' + ver(r)).sort().join();
    state.rfqData = merged;
    try {
      localStorage.setItem(RFQ_KEY, JSON.stringify(merged));
      localStorage.setItem(RFQ_DEL_KEY, JSON.stringify([...deleted]));
    } catch(e) {}
    // Local had RFQs the server didn't (e.g. created before server sync existed) — upload them
    if (serverIds !== mergedIds || deleted.size !== (d.deleted || []).length) pushRFQ();
    const view = document.getElementById('rfq-view');
    if (view && view.style.display !== 'none') import('../views/rfq.js').then(({ renderRFQ }) => renderRFQ());
  } catch(e) {}
}

export function addRFQ(rec) {
  touch(rec);
  state.rfqData.unshift(rec);
  saveRFQ();
  import('../views/rfq.js').then(({ renderRFQ }) => renderRFQ());
}

export function setRFQStatus(id, status) {
  const rec = state.rfqData.find(r => r.id === id);
  if (!rec) return;
  rec.status = status;
  if (status === 'sent' && !rec.responseAt) rec.responseAt = Date.now();
  if (status === 'new' || status === 'in_progress') rec.responseAt = null;
  touch(rec);
  saveRFQ();
  import('../views/rfq.js').then(({ renderRFQ }) => renderRFQ());
}

export function saveRFQNote(id, val) {
  const rec = state.rfqData.find(r => r.id === id);
  if (!rec) return;
  rec.notes = val;
  touch(rec);
  saveRFQ();
}

export function deleteRFQ(id) {
  if (!confirm('למחוק בקשה זו?')) return;
  state.rfqData = state.rfqData.filter(r => r.id !== id);
  try { localStorage.setItem(RFQ_DEL_KEY, JSON.stringify([...loadDeleted(), id])); } catch(e) {}
  saveRFQ();
  import('../views/rfq.js').then(({ renderRFQ }) => renderRFQ());
}

export function startRFQTimer() {
  stopRFQTimer();
  state._rfqTimer = setInterval(() => {
    if (document.getElementById('rfq-view').style.display !== 'none') {
      import('../views/rfq.js').then(({ renderRFQList }) => renderRFQList());
    }
  }, 60000);
}

export function stopRFQTimer() {
  if (state._rfqTimer) { clearInterval(state._rfqTimer); state._rfqTimer = null; }
}
