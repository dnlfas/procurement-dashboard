import { state } from '../state.js';
import { esc, autoH } from '../utils.js';
import {
  rfqCountdown, rfqUrgencyClass, rfqUrgencyDot, rfqStatusBadge,
  fmtDT, rfqDeadline, rfqSortKey, addRFQ, startRFQTimer, stopRFQTimer, saveRFQNote
} from '../rfq/engine.js';

export function renderRFQ() {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const open = state.rfqData.filter(r => r.status === 'new' || r.status === 'in_progress');
  const urgent = state.rfqData.filter(r => {
    if (r.status !== 'new' && r.status !== 'in_progress') return false;
    return rfqDeadline(r) - now < 12 * 3600000;
  });
  const sentWeek = state.rfqData.filter(r => r.status === 'sent' && r.responseAt && r.responseAt >= weekAgo);
  const withResp = state.rfqData.filter(r => r.responseAt);
  const avgH = withResp.length ? Math.round(withResp.reduce((s, r) => s + (r.responseAt - r.receivedAt), 0) / withResp.length / 3600000) : null;

  document.getElementById('rk1').textContent = open.length;
  document.getElementById('rk1s').textContent = open.length === 1 ? 'בקשה אחת' : open.length + ' בקשות';
  document.getElementById('rk2').textContent = urgent.length;
  document.getElementById('rk2s').textContent = urgent.filter(r => rfqDeadline(r) < now).length + ' באיחור';
  document.getElementById('rk3').textContent = sentWeek.length;
  document.getElementById('rk3s').textContent = '7 ימים אחרונים';
  document.getElementById('rk4').textContent = avgH !== null ? avgH : '—';
  document.getElementById('rk4s').textContent = avgH !== null ? 'שעות בממוצע' : 'אין נתונים';

  renderRFQList();
  startRFQTimer();
}

export function renderRFQList() {
  const search = (document.getElementById('rfq-search') || {}).value || '';
  const sl = search.trim().toLowerCase();
  let list = [...state.rfqData];

  if (state._rfqFilter === 'open') list = list.filter(r => r.status === 'new' || r.status === 'in_progress');
  else if (state._rfqFilter === 'urgent') list = list.filter(r => {
    if (r.status !== 'new' && r.status !== 'in_progress') return false;
    return rfqDeadline(r) - Date.now() < 12 * 3600000;
  });
  else if (state._rfqFilter === 'sent') list = list.filter(r => r.status === 'sent');
  else if (state._rfqFilter === 'closed') list = list.filter(r => r.status === 'closed' || r.status === 'cancelled');

  if (sl) list = list.filter(r => {
    const istr = Array.isArray(r.items) ? r.items.map(i => Object.values(i).join(' ')).join(' ') : (r.items || '');
    return (r.customer || '').toLowerCase().includes(sl) || (r.reqNum || '').toLowerCase().includes(sl) || istr.toLowerCase().includes(sl);
  });

  list.sort((a, b) => rfqSortKey(a) - rfqSortKey(b));

  const el = document.getElementById('rfq-list');
  if (!list.length) { el.innerHTML = '<div class="empty">אין בקשות</div>'; return; }

  el.innerHTML = list.map(rec => {
    const cd = rfqCountdown(rec);
    const uc = rfqUrgencyClass(rec);
    const open = rec.status === 'new' || rec.status === 'in_progress';
    const actionBtns = open ? `
      <button class="btn btn-blue" style="font-size:12px;padding:4px 12px" onclick="setRFQStatus('${rec.id}','sent')">✓ נשלח</button>
      ${rec.status === 'new' ? `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="setRFQStatus('${rec.id}','in_progress')">⚙ בטיפול</button>` : ''}
      <button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="setRFQStatus('${rec.id}','closed')">✕ סגור</button>
    ` : `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="setRFQStatus('${rec.id}','new')">↩ פתח מחדש</button>`;
    return `<div class="rfq-card ${uc}" id="rfqc_${rec.id}">
      <div class="rfq-hdr">
        ${rfqUrgencyDot(rec)}
        <div class="rfq-cust">${esc(rec.customer)}</div>
        <div class="rfq-reqnum">${esc(rec.reqNum || 'ללא מספר')}</div>
        ${rfqStatusBadge(rec.status)}
        ${cd.label ? `<span class="rfq-countdown ${cd.cls}">${cd.label}</span>` : ''}
      </div>
      ${rfqItemsTable(rec.items)}
      <div class="rfq-meta">
        <span>נכנס: ${fmtDT(rec.receivedAt)}</span>
        <span>דדליין: ${fmtDT(rfqDeadline(rec))}</span>
        ${rec.responseAt ? `<span>נשלח: ${fmtDT(rec.responseAt)}</span>` : ''}
      </div>
      <textarea class="note-ta" placeholder="הערות..." rows="1" oninput="autoH(this);saveRFQNote('${rec.id}',this.value)">${esc(rec.notes || '')}</textarea>
      <div class="rfq-actions">
        ${actionBtns}
        <button class="rfq-del" onclick="deleteRFQ('${rec.id}')" title="מחק">🗑 מחק</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.note-ta').forEach(ta => autoH(ta));
}

export function setRFQFilter(f) {
  state._rfqFilter = f;
  ['all','open','urgent','sent','closed'].forEach(k => {
    document.getElementById('rfqf-' + k).classList.toggle('on', k === f);
  });
  renderRFQList();
}

export function rfqItemsTable(items) {
  if (!items || !items.length) return '';
  if (!Array.isArray(items)) return `<div class="rfq-items">${esc(items)}</div>`;
  return `<div style="overflow-x:auto"><table class="rfq-tbl">
    <thead><tr><th>MPN</th><th>MFG</th><th>כמות</th><th>הערות</th></tr></thead>
    <tbody>${items.map(r => `<tr>
      <td class="tc-mpn">${esc(r.mpn || '')}</td>
      <td>${esc(r.mfg || '')}</td>
      <td>${esc(r.qty || '')}</td>
      <td>${esc(r.notes || '')}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

export function addRFQRow(p) {
  p = p || {};
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="padding:3px 5px"><input class="rfq-row-inp" placeholder="MPN" value="${esc(p.mpn || '')}"></td>
    <td style="padding:3px 5px"><input class="rfq-row-inp" placeholder="MFG" value="${esc(p.mfg || '')}"></td>
    <td style="padding:3px 5px"><input class="rfq-row-inp" placeholder="כמות" style="max-width:70px" value="${esc(p.qty || '')}"></td>
    <td style="padding:3px 5px"><input class="rfq-row-inp" placeholder="הערות" value="${esc(p.notes || '')}"></td>
    <td style="padding:3px 5px;text-align:center"><button onclick="removeRFQRow(this)" style="background:none;border:none;color:var(--txt2);cursor:pointer;font-size:15px;padding:0 2px;line-height:1" title="מחק שורה">✕</button></td>
  `;
  document.getElementById('rfq-items-body').appendChild(tr);
}

export function removeRFQRow(btn) {
  const body = document.getElementById('rfq-items-body');
  if (body.rows.length > 1) btn.closest('tr').remove();
}

export function getRFQItems() {
  return [...document.getElementById('rfq-items-body').rows].map(tr => {
    const inp = tr.querySelectorAll('input');
    return { mpn: inp[0].value.trim(), mfg: inp[1].value.trim(), qty: inp[2].value.trim(), notes: inp[3].value.trim() };
  }).filter(r => r.mpn || r.mfg || r.qty || r.notes);
}

export function openRFQModal(prefill) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const local = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  const p = prefill || {};
  document.getElementById('rfq-f-cust').value = p.customer || '';
  document.getElementById('rfq-f-req').value = p.reqNum || '';
  document.getElementById('rfq-f-date').value = p.receivedDate || local;
  const body = document.getElementById('rfq-items-body');
  body.innerHTML = '';
  const rows = Array.isArray(p.items) && p.items.length ? p.items : null;
  if (rows) rows.forEach(r => addRFQRow(r)); else addRFQRow();
  document.getElementById('rfq-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rfq-f-cust').focus(), 50);
}

export function closeRFQModal() { document.getElementById('rfq-modal').style.display = 'none'; }

export function submitRFQModal() {
  const cust = document.getElementById('rfq-f-cust').value.trim();
  if (!cust) { document.getElementById('rfq-f-cust').focus(); return; }
  const req = document.getElementById('rfq-f-req').value.trim();
  const items = getRFQItems();
  const dateVal = document.getElementById('rfq-f-date').value;
  const receivedAt = dateVal ? new Date(dateVal).getTime() : Date.now();
  const rec = { id: rfqUidFn(), customer: cust, reqNum: req, items, receivedAt, status: 'new', notes: '', responseAt: null };
  closeRFQModal();
  addRFQ(rec);
  import('../utils.js').then(({ toast }) => toast('✓ בקשת הצעת מחיר נשמרה'));
}

// Import rfqUid lazily to avoid circular
async function rfqUidFn() {
  const { rfqUid } = await import('../rfq/engine.js');
  return rfqUid();
}
