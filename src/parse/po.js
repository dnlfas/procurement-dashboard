import { state, TODAY } from '../state.js';
import { s } from '../utils.js';
import { _findKey } from './so.js';
import { buildGroups } from './so.js';
import { applyOverridesToRows } from '../persistence.js';
import { syncOverrides } from '../persistence.js';

export function parsePORows(raw) {
  if (!raw.length) return [];
  const keys = Object.keys(raw[0]);
  console.log('[PO columns]', keys);
  const PK = {
    poNum:   _findKey(keys, ['הזמנה']),
    mpn:     keys.find(k => k.includes('מק') || k.includes('מקט') || k === 'מספר פריט') || 'מספר פריט',
    supp:    _findKey(keys, ['שם ספק']),
    desc:    _findKey(keys, ['תאור פריט', 'תיאור פריט', 'תאור', 'תיאור']),
    qtyO:    _findKey(keys, ['כמות בהזמנה']),
    qtyS:    _findKey(keys, ['כמות שסופקה', 'סופק']),
    qtyR:    _findKey(keys, ['יתרה לאספקה', 'יתרה']),
    valILS:  _findKey(keys, ['שווי היתרה בשקלים', 'שווי שקל']),
    valOrig: _findKey(keys, ['שווי היתרה', 'שווי']),
    curr:    _findKey(keys, ['מטבע']),
    date:    _findKey(keys, ['ת. אספקה', 'תאריך אספקה']),
  };
  console.log('[PO keys used]', PK);
  return raw.map(r => {
    const poNum = s(r[PK.poNum]);
    const mpn = s(r[PK.mpn]);
    if (!poNum && !mpn) return null;
    // ERP marks currency on the name: "$- Name" or "Name -$" (sometimes with a stray Hebrew vowel mark)
    const supplier = s(r[PK.supp]).replace(/^\$-\s*/, '').replace(/[\s\u0591-\u05C7]*-?\s*\$\s*$/, '').trim();
    const desc = s(r[PK.desc]);
    const qtyO = parseFloat(r[PK.qtyO]) || 0;
    const qtyS = parseFloat(r[PK.qtyS]) || 0;
    const qtyR = parseFloat(r[PK.qtyR]) || 0;
    const valILS = parseFloat(r[PK.valILS]) || 0;
    const valOrig = parseFloat(r[PK.valOrig]) || 0;
    const currency = s(r[PK.curr]) || 'ILS';
    let dd = null;
    const rd = r[PK.date];
    if (rd instanceof Date && !isNaN(rd)) dd = new Date(rd.getFullYear(), rd.getMonth(), rd.getDate());
    else if (typeof rd === 'number' && rd > 1) { const d = new Date(Math.round((rd - 25569) * 86400000)); dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    else if (typeof rd === 'string' && rd) { const d = new Date(rd); if (!isNaN(d)) dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    const isOvr = !!(dd && dd < TODAY);
    const isPartial = qtyS > 0 && qtyR > 0;
    return { poNum, mpn, supplier, desc, qtyO, qtyS, qtyR, valILS, valOrig, currency, dd, isOvr, isPartial };
  }).filter(Boolean);
}

export function parsePOFile(raw) {
  return raw.map(r => {
    const mpn = s(r["מק'ט"] || r['מקט'] || r['MPN'] || r['Part Number'] || '');
    const po = s(r['הזמנה'] || r['PO'] || r['מספר הזמנה'] || '');
    const supplier = s(r['שם ספק'] || r['ספק'] || r['Supplier'] || '');
    const suppId = s(r["מס' ספק"] || '');
    const priceILS = s(r['מחיר סופי בשקלים'] || r['מחיר'] || '');
    const currency = s(r['מטבע'] || '');
    const price = s(r['מחיר סופי'] || '');
    if (!mpn && !po) return null;
    return { mpn, po, supplier, suppId, priceILS, currency, price };
  }).filter(Boolean);
}

export function bestPOMatch(soRow, candidates) {
  if (!candidates.length) return null;
  if (!soRow.dd || candidates.length === 1) return candidates[0];
  return candidates.reduce((best, p) => {
    if (!p.dd) return best || p;
    if (!best || !best.dd) return p;
    return Math.abs(p.dd - soRow.dd) < Math.abs(best.dd - soRow.dd) ? p : best;
  }, null) || candidates[0];
}

// SO lines that no longer need PO quantity: closed, or goods already received from the supplier
const NO_DEMAND = ['supplied', 'cancelled', 'cancelled_bts', 'qc', 'delivery_bts', 'waiting_cust'];
const byDate = (a, b) => (a.dd ? a.dd.getTime() : Infinity) - (b.dd ? b.dd.getTime() : Infinity);

// Split each PO's open quantity (qtyR) across the SO lines that need the same MPN.
// Lines explicitly linked to a PO draw from it first; the rest is handed out by earliest SO due date.
// Sets on each row: alloc [{po, qty}], allocQty, short (units with no PO), allocLate (a PO arrives after the SO due date).
export function allocatePOs(byMPNList) {
  const left = new Map();
  state.poRows.forEach(p => left.set(p, p.qtyR));
  const take = (r, p) => {
    const q = Math.min(left.get(p), r.qtyR - r.allocQty);
    if (q <= 0) return;
    left.set(p, left.get(p) - q);
    r.allocQty += q;
    const a = r.alloc.find(x => x.po === p);
    if (a) a.qty += q; else r.alloc.push({ po: p, qty: q });
  };
  const demandByMPN = {};
  state.allRows.forEach(r => {
    r.alloc = []; r.allocQty = 0; r.short = 0; r.allocLate = false;
    if (r.qtyR > 0 && !NO_DEMAND.includes(r.status)) {
      const k = r.mpn.trim().toUpperCase();
      (demandByMPN[k] = demandByMPN[k] || []).push(r);
    }
  });
  Object.entries(demandByMPN).forEach(([k, lines]) => {
    const pos = (byMPNList[k] || []).filter(p => p.qtyR > 0).sort(byDate);
    lines.sort(byDate);
    lines.forEach(r => { if (r.poNum) pos.filter(p => p.poNum === r.poNum).forEach(p => take(r, p)); });
    lines.forEach(r => pos.forEach(p => take(r, p)));
    lines.forEach(r => {
      // A line linked to a PO that isn't in the open-PO report (e.g. already fully received) — can't judge, don't flag
      const linkedClosed = r.poNum && !pos.some(p => p.poNum === r.poNum);
      r.short = linkedClosed ? 0 : r.qtyR - r.allocQty;
      r.allocLate = !!(r.dd && r.alloc.some(a => a.po.dd && a.po.dd > r.dd));
    });
  });
}

export function linkPOtoSO() {
  if (!state.poLoaded || !state.allRows.length) return;
  const byMPNList = {};
  state.poRows.forEach(p => { const k = p.mpn.trim().toUpperCase(); if (!byMPNList[k]) byMPNList[k] = []; byMPNList[k].push(p); });
  allocatePOs(byMPNList);
  let statusChanged = false;
  state.allRows.forEach(r => {
    const k = r.mpn.trim().toUpperCase();
    const all = byMPNList[k] || [];
    const fullyCovered = r.allocQty > 0 && r.short === 0;
    if (r.cov !== 'green' && fullyCovered) r.cov = 'green';
    const allocPO = r.alloc[0]?.po;
    const supplierHint = allocPO || bestPOMatch(r, all.filter(p => p.qtyR > 0));
    if (!r.supplier && supplierHint) r.supplier = supplierHint.supplier;
    if (!r.poNum && !state.fieldOvr[r.nk + '__po'] && fullyCovered) r.poNum = allocPO.poNum;
    if (state.statusOvr[r.nk] === undefined) {
      // Infer status only from a PO this line is actually tied to, never from another customer's PO for the same MPN
      const linked = r.poNum ? all.find(p => p.poNum === r.poNum) : null;
      const p = linked || (fullyCovered ? allocPO : null);
      if (p) {
        let inferred = null;
        if (p.qtyS > 0 && p.qtyR > 0) inferred = 'partial';
        else if (p.qtyS > 0 && p.qtyR === 0) inferred = 'supplied';
        else if (p.qtyR > 0) inferred = 'ordered';
        if (inferred) { state.statusOvr[r.nk] = inferred; statusChanged = true; }
      }
    }
  });
  if (statusChanged) {
    localStorage.setItem('oo_status', JSON.stringify(state.statusOvr));
    applyOverridesToRows(state.allRows);
    syncOverrides();
  }
  state.soGroups = buildGroups(state.allRows);
}
