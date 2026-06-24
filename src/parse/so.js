import { state, TODAY } from '../state.js';
import { s } from '../utils.js';

export function _findKey(keys, needles) {
  return keys.find(k => needles.some(n => k.includes(n))) || needles[0];
}

export function parseRows(raw) {
  if (!raw.length) return [];
  const keys = Object.keys(raw[0]);
  console.log('[SO columns]', keys);
  const K = {
    so:     _findKey(keys, ['הזמנה']),
    mpn:    _findKey(keys, ['מספר פריט', 'מק"ט', "מק'ט", 'מקט']),
    cust:   _findKey(keys, ['שם לקוח']),
    custPO: _findKey(keys, ['הז. רכש', 'הזמנת רכש (לקוח)']),
    poNum:  _findKey(keys, ['מספר הזמנת רכש']),
    supp:   _findKey(keys, ['שם ספק']),
    status: _findKey(keys, ['סטטוס פריט']),
    qtyR:   _findKey(keys, ['יתרה לאספקה']),
    qtyO:   _findKey(keys, ['כמות בהזמנה']),
    date:   _findKey(keys, ['ת. אספקה', 'תאריך אספקה']),
    price:  _findKey(keys, ['מחיר ליחידה', 'מחיר יחידה']),
    curr:   _findKey(keys, ['יחידת מטבע', 'מטבע']),
  };
  console.log('[SO keys used]', K);
  let _so = '', _cust = '', _custPO = '';
  return raw.map(r => {
    const rawSO = s(r[K.so]), mpn = s(r[K.mpn]);
    const rawCust = s(r[K.cust]);
    const rawCustPO = s(r[K.custPO]);
    if (rawSO) { _so = rawSO; _cust = rawCust; _custPO = rawCustPO; }
    const so = rawSO || _so;
    if (!so && !mpn) return null;
    const customer = rawCust || _cust;
    const custPO = rawCustPO || _custPO;
    const poNum = s(r[K.poNum]);
    const supplier = s(r[K.supp]).replace(/^\$-\s*/, '').trim();
    const statusRaw = s(r[K.status]);
    const qtyR = parseFloat(r[K.qtyR]) || 0;
    const qtyO = parseFloat(r[K.qtyO]) || 0;
    const priceRaw = String(r[K.price] || '');
    const price = parseFloat(priceRaw.replace(/[^\d.-]/g, '')) || 0;
    const currFromPrice = /\$/.test(priceRaw) ? '$' : /€/.test(priceRaw) ? 'EUR' : /£/.test(priceRaw) ? 'GBP' : '';
    const priceIdx = keys.indexOf(K.price);
    let currFromAdj = '';
    for (let ci = priceIdx + 1; ci <= priceIdx + 2 && ci < keys.length; ci++) {
      const v = s(r[keys[ci]]).trim();
      if (v === '$' || v === 'USD') { currFromAdj = '$'; break; }
      if (v === 'ILS') { currFromAdj = 'ILS'; break; }
      if (v === 'EUR' || v === '€') { currFromAdj = 'EUR'; break; }
      if (v === 'GBP' || v === '£') { currFromAdj = 'GBP'; break; }
    }
    const currColRaw = s(r[K.curr]).trim();
    const currFromCol = currColRaw === '$' || currColRaw === 'USD' ? '$' : currColRaw === 'ILS' ? 'ILS' : currColRaw === 'EUR' ? 'EUR' : currColRaw === 'GBP' ? 'GBP' : '';
    const currency = currFromPrice || currFromAdj || currFromCol || 'ILS';
    let dd = null;
    const rd = r[K.date];
    if (rd instanceof Date && !isNaN(rd)) dd = new Date(rd.getFullYear(), rd.getMonth(), rd.getDate());
    else if (typeof rd === 'number' && rd > 1) { const d = new Date(Math.round((rd - 25569) * 86400000)); dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    else if (typeof rd === 'string' && rd) { const d = new Date(rd); if (!isNaN(d)) dd = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    let status = 'none';
    const sl = statusRaw.trim();
    if (sl === 'הוזמן מהספק') status = 'ordered';
    else if (sl === 'טרם הוזמן') status = 'pending';
    else if (sl.includes('בקרת איכות ספק') || sl.includes('מעבדה')) status = 'qc_supp';
    else if (sl.includes('בקרת איכות')) status = 'qc';
    else if (sl.includes('מחסן המוצא')) status = 'waiting_wh';
    else if (sl.includes('נחת בארץ')) status = 'in_transit';
    else if (sl.includes('הגשות למכס')) status = 'customs_sub';
    else if (sl.includes('שוחרר ממכס')) status = 'customs_rel';
    else if (sl.includes('שליחות') || sl.includes('BTS')) status = 'delivery_bts';
    else if (sl.includes('סופק ללקוח')) status = 'supplied';
    else if (sl.includes('סופק חלקי')) status = 'partial';
    else if (sl.includes('ממתין לאספקה')) status = 'waiting_cust';
    else if (sl.includes('איתור ספק')) status = 'sourcing';
    else if (sl.includes('בוטל ע"י הלקוח') || sl.includes("בוטל ע'י הלקוח")) status = 'cancelled';
    else if (sl.includes('בוטל ע"י BTS') || sl.includes("בוטל ע'י BTS")) status = 'cancelled_bts';
    else if (sl.includes('בוטל')) status = 'cancelled';
    else if (sl) status = 'other';
    const isOvr = !!(dd && dd < TODAY);
    let cov = 'grey';
    if (!!poNum || status === 'ordered') cov = 'green';
    else if (status !== 'none' && status !== 'cancelled') cov = 'orange';
    else if (isOvr) cov = 'red';
    const daysOvr = (isOvr && dd) ? Math.floor((TODAY - dd) / 86400000) : 0;
    return { so, mpn, customer, custPO, poNum, supplier, statusRaw, status, qtyO, qtyR, price, currency, dd, cov, daysOvr, isOvr, nk: so + '__' + mpn };
  }).filter(Boolean);
}

export function _dbgSO(rows) {
  const custs = [...new Set(rows.map(r => r.customer))];
  console.log('[SO parsed]', rows.length, 'rows,', custs.length, 'unique customers:', custs);
  const noCust = rows.filter(r => !r.customer);
  if (noCust.length) console.log('[SO no-customer rows]', noCust.length, 'rows, SOs:', [...new Set(noCust.map(r => r.so))]);
  const noSO = rows.filter(r => !r.so);
  if (noSO.length) console.log('[SO no-SO rows]', noSO.length, 'rows');
}

export function buildGroups(rows) {
  _dbgSO(rows);
  const m = {};
  rows.forEach(r => {
    if (!m[r.so]) m[r.so] = { so: r.so, customer: r.customer, custPO: r.custPO, lines: [] };
    m[r.so].lines.push(r);
  });
  Object.values(m).forEach(g => {
    const c = g.customer || g.lines.find(r => r.customer)?.customer || '';
    if (c) { g.customer = c; g.lines.forEach(r => { if (!r.customer) r.customer = c; }); }
  });
  return Object.values(m).map(calcG).sort((a, b) => {
    const o = { red: 0, orange: 1, green: 2, grey: 3 };
    if (o[a.tl] !== o[b.tl]) return o[a.tl] - o[b.tl];
    if (!a.mn) return 1; if (!b.mn) return -1; return a.mn - b.mn;
  });
}

export function calcG(g) {
  const l = g.lines, ds = l.map(x => x.dd).filter(Boolean);
  g.mn = ds.length ? new Date(Math.min(...ds.map(d => d.getTime()))) : null;
  g.mx = ds.length ? new Date(Math.max(...ds.map(d => d.getTime()))) : null;
  g.ovr = l.filter(x => x.isOvr && x.status !== 'supplied').length;
  g.unc = l.filter(x => x.cov !== 'green' && x.status !== 'supplied').length;
  g.cov = l.filter(x => x.cov === 'green').length;
  if (g.ovr > 0) g.tl = 'red'; else if (g.unc > 0) g.tl = 'orange'; else g.tl = 'green';
  g.supps = [...new Set(l.map(x => x.supplier).filter(Boolean))];
  g.isPull = l.some(x => x.isPull);
  return g;
}
