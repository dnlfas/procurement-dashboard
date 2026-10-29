// Global topbar search: one box that finds customers, SOs, parts, suppliers, POs and RFQs,
// and can push the query as a filter into every view's own search field.
import { state } from './state.js';
import { esc } from './utils.js';
import { setMainView, setEmpTab, openSOInEmp } from './nav.js';
import { applyFilters, expandAll } from './views/employee.js';
import { renderSuppliers } from './views/supplier.js';
import { setRFQFilter } from './views/rfq.js';

const PER_GROUP = 5;
let _hits = [];   // flat list of actionable results, in display order
let _sel = -1;    // keyboard-highlighted index into _hits

const inc = (v, q) => String(v || '').toUpperCase().includes(q);
const el = id => document.getElementById(id);

function collect(q) {
  const groups = [];
  const add = (title, items) => { if (items.length) groups.push({ title, items }); };
  const live = state.allRows.filter(r => r.status !== 'cancelled' && r.status !== 'cancelled_bts');

  const custs = {};
  live.forEach(r => { if (r.customer && inc(r.customer, q)) custs[r.customer] = (custs[r.customer] || 0) + 1; });
  add('לקוחות', Object.entries(custs).sort((a, b) => b[1] - a[1]).map(([c, n]) =>
    ({ label: c, sub: n + ' שורות', go: () => goCustomer(c) })));

  const sos = {};
  live.forEach(r => {
    if (!sos[r.so] && (inc(r.so, q) || inc(r.custPO, q))) sos[r.so] = r;
  });
  add('הזמנות SO', Object.values(sos).map(r =>
    ({ label: r.so, sub: [r.customer, r.custPO && 'PO לקוח ' + r.custPO].filter(Boolean).join(' · '), mono: true, go: () => goSO(r.so) })));

  const mpns = {};
  live.forEach(r => {
    if (!inc(r.mpn, q)) return;
    const k = r.mpn.trim().toUpperCase();
    (mpns[k] = mpns[k] || { mpn: r.mpn, sos: new Set(), ovr: false }).sos.add(r.so);
    if (r.isOvr) mpns[k].ovr = true;
  });
  add('פריטים (MPN)', Object.values(mpns).map(m =>
    ({ label: m.mpn, sub: m.sos.size + ' הזמנות' + (m.ovr ? ' · 🔴 באיחור' : ''), mono: true, go: () => goMPN(m.mpn) })));

  const supps = {};
  state.poRows.forEach(r => { if (r.supplier && inc(r.supplier, q)) supps[r.supplier] = (supps[r.supplier] || 0) + 1; });
  live.forEach(r => { if (r.supplier && inc(r.supplier, q) && !supps[r.supplier]) supps[r.supplier] = 0; });
  add('ספקים', Object.entries(supps).sort((a, b) => b[1] - a[1]).map(([sp, n]) =>
    ({ label: sp, sub: n ? n + ' שורות PO' : 'ב-SO בלבד', go: () => goSupplier(sp, n > 0) })));

  const pos = {};
  state.poRows.forEach(r => {
    if (r.poNum && !pos[r.poNum] && (inc(r.poNum, q) || inc(r.mpn, q))) pos[r.poNum] = r;
  });
  add('הזמנות רכש PO', Object.values(pos).map(r =>
    ({ label: r.poNum, sub: [r.supplier, !inc(r.poNum, q) && r.mpn].filter(Boolean).join(' · '), mono: true, go: () => goSupplierQuery(r.poNum) })));

  const rfqs = state.rfqData.filter(r => {
    const items = Array.isArray(r.items) ? r.items.map(i => Object.values(i).join(' ')).join(' ') : r.items;
    return inc(r.customer, q) || inc(r.reqNum, q) || inc(items, q);
  });
  add('RFQ', rfqs.map(r =>
    ({ label: r.customer || '—', sub: r.reqNum || 'ללא מספר', go: () => goRFQ(r) })));

  return groups;
}

function render() {
  const q = el('gs-input').value.trim();
  const box = el('gs-results');
  el('gs-clear').style.display = q ? '' : 'none';
  _hits = []; _sel = -1;
  if (!q) { box.style.display = 'none'; return; }

  const groups = collect(q.toUpperCase());
  const filterRow = { go: () => applyGlobalFilter(q) };
  _hits.push(filterRow);
  let html = `<div class="gs-item gs-filter" data-i="0"><span>סנן את כל המסכים לפי "<b>${esc(q)}</b>"</span><span class="gs-key">Enter</span></div>`;
  if (!groups.length) html += '<div class="gs-empty">לא נמצאו תוצאות</div>';
  groups.forEach(g => {
    html += `<div class="gs-group">${g.title} <span>${g.items.length}</span></div>`;
    g.items.slice(0, PER_GROUP).forEach(it => {
      const i = _hits.push(it) - 1;
      html += `<div class="gs-item" data-i="${i}"><span class="gs-lbl${it.mono ? ' gs-mono' : ''}">${esc(it.label)}</span><span class="gs-sub">${esc(it.sub)}</span></div>`;
    });
    if (g.items.length > PER_GROUP) html += `<div class="gs-more">+${g.items.length - PER_GROUP} נוספים — Enter לסינון</div>`;
  });
  box.innerHTML = html;
  box.style.display = 'block';
}

function highlight(i) {
  _sel = i;
  el('gs-results').querySelectorAll('.gs-item').forEach(n => n.classList.toggle('sel', +n.dataset.i === i));
  el('gs-results').querySelector('.gs-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function pick(i) {
  const hit = _hits[i];
  if (!hit) return;
  el('gs-results').style.display = 'none';
  el('gs-input').blur();
  hit.go();
}

// ── Navigation targets ────────────────────────────────────────
function resetSOFilters() {
  ['fc', 'fs', 'fpull'].forEach(id => { if (el(id)) el(id).value = ''; });
  ['fu', 'fo'].forEach(id => { if (el(id)) el(id).checked = false; });
  el('fq').value = '';
}
function goCustomer(c) {
  resetSOFilters();
  el('fc').value = c;
  applyFilters();
  setMainView('emp'); setEmpTab('so');
}
function goSO(so) {
  resetSOFilters();
  applyFilters();
  openSOInEmp(so);
}
function goMPN(mpn) {
  resetSOFilters();
  el('fq').value = mpn;
  applyFilters();
  setMainView('emp'); setEmpTab('so');
  expandAll(true);
}
function goSupplier(sp, hasPO) {
  if (!hasPO) {
    resetSOFilters();
    el('fs').value = sp;
    applyFilters();
    setMainView('emp'); setEmpTab('so');
    return;
  }
  goSupplierQuery(sp);
}
function goSupplierQuery(q) {
  el('supp-search').value = q;
  el('supp-ovr-only').checked = false;
  renderSuppliers();
  setMainView('supp');
}
function goRFQ(r) {
  el('rfq-search').value = r.reqNum || r.customer || '';
  setMainView('rfq');
  setRFQFilter('all');
  requestAnimationFrame(() => el('rfqc_' + r.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// Push the query into every view's own search box. From the manager view, jump to the order list.
export function applyGlobalFilter(q) {
  el('fq').value = q;
  el('supp-search').value = q;
  el('rfq-search').value = q;
  applyFilters();
  renderSuppliers();
  setRFQFilter(state._rfqFilter);
  if (el('boss-view').style.display !== 'none') { setMainView('emp'); setEmpTab('so'); }
  el('gs-input').classList.toggle('gs-active', !!q);
}

export function clearGlobalSearch() {
  const wasActive = el('gs-input').classList.contains('gs-active');
  el('gs-input').value = '';
  render();
  if (wasActive) applyGlobalFilter('');
}

export function initGlobalSearch() {
  const inp = el('gs-input'), box = el('gs-results');
  inp.addEventListener('input', render);
  inp.addEventListener('focus', () => { if (inp.value.trim()) render(); });
  inp.addEventListener('blur', () => setTimeout(() => { box.style.display = 'none'; }, 150));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(_sel + 1, _hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(_sel - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(_sel >= 0 ? _sel : 0); }
    else if (e.key === 'Escape') { if (inp.value) clearGlobalSearch(); else inp.blur(); }
  });
  box.addEventListener('mousedown', e => {
    const n = e.target.closest('.gs-item');
    if (n) { e.preventDefault(); pick(+n.dataset.i); }
  });
  // Ctrl+K or "/" focuses the search from anywhere (except while typing in another field)
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
      e.preventDefault(); inp.focus(); inp.select();
    }
  });
}
