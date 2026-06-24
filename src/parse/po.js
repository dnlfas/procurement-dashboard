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
    const supplier = s(r[PK.supp]).replace(/^\$-\s*/, '').trim();
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

export function linkPOtoSO() {
  if (!state.poLoaded || !state.allRows.length) return;
  const byMPNList = {};
  state.poRows.forEach(p => { const k = p.mpn.trim().toUpperCase(); if (!byMPNList[k]) byMPNList[k] = []; byMPNList[k].push(p); });
  let statusChanged = false;
  state.allRows.forEach(r => {
    const k = r.mpn.trim().toUpperCase();
    const all = byMPNList[k] || [];
    const withQty = all.filter(p => p.qtyR > 0);
    if ((r.cov === 'orange' || r.cov === 'red') && withQty.length) r.cov = 'green';
    const bestWithQty = bestPOMatch(r, withQty);
    if (!r.supplier && bestWithQty) r.supplier = bestWithQty.supplier;
    const bestAll = bestPOMatch(r, all);
    if (!r.poNum && !state.fieldOvr[r.nk + '__po'] && bestAll?.poNum) r.poNum = bestAll.poNum;
    if (state.statusOvr[r.nk] === undefined) {
      const p = bestAll;
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
