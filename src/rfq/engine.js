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

export function saveRFQ() { localStorage.setItem(RFQ_KEY, JSON.stringify(state.rfqData)); }

export function addRFQ(rec) {
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
  saveRFQ();
  import('../views/rfq.js').then(({ renderRFQ }) => renderRFQ());
}

export function saveRFQNote(id, val) {
  const rec = state.rfqData.find(r => r.id === id);
  if (!rec) return;
  rec.notes = val;
  saveRFQ();
}

export function deleteRFQ(id) {
  if (!confirm('למחוק בקשה זו?')) return;
  state.rfqData = state.rfqData.filter(r => r.id !== id);
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
