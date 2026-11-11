// SO → PO: parse supplier quotes, pick a supplier per SO line, sanity-check it, and build Priority paste tables.
// Pure functions only (no DOM / state) so the logic can be exercised outside the browser.

export const SOPO_RULES = {
  minMargin: 0.07,     // warn below 7% margin, block at 0% or less
  aboveMarket: 1.5,    // warn when the quote is > 1.5× the verified online median
  belowMarket: 0.5,    // warn when the quote is < 0.5× (counterfeit / typo risk)
};

// ILS per 1 unit of currency; overwritten by Bank of Israel rates when available
export const DEFAULT_RATES = { ILS: 1, USD: 3.7, EUR: 4.0, GBP: 4.7 };

const CUR_MAP = { '$': 'USD', 'USD': 'USD', 'US$': 'USD', 'דולר': 'USD', '€': 'EUR', 'EUR': 'EUR', 'יורו': 'EUR', '£': 'GBP', 'GBP': 'GBP', '₪': 'ILS', 'ILS': 'ILS', 'NIS': 'ILS', 'ש"ח': 'ILS', 'שח': 'ILS', 'שקל': 'ILS' };

// '$' / 'usd' / '₪' / 'ש"ח' → 'USD' / 'ILS' …; '' when unknown
export function cur3(v) {
  const t = String(v || '').trim().toUpperCase();
  if (!t) return '';
  if (CUR_MAP[t]) return CUR_MAP[t];
  for (const [k, c] of Object.entries(CUR_MAP)) if (t.includes(k)) return c;
  return '';
}

export function fxConvert(amount, from, to, rates) {
  const r = rates || DEFAULT_RATES;
  const f = r[from || 'USD'], t = r[to || 'USD'];
  if (!f || !t) return amount;
  return amount * f / t;
}

// "6-8 wks" → 56, "10 days" → 10, "stock" → 0, 6 (with weeks header) → 42; null when unknown
export function leadDays(v, headerUnit) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * (headerUnit === 'days' ? 1 : 7));
  const t = String(v).toLowerCase().trim();
  if (/stock|מלאי|asap|immediate|מיידי/.test(t)) return 0;
  const nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;
  const n = Math.max(...nums);
  if (/day|יום|ימים|\bd\b/.test(t)) return Math.round(n);
  if (/month|חודש/.test(t)) return Math.round(n * 30);
  if (/w|שבוע|שב'/.test(t)) return Math.round(n * 7);
  return Math.round(n * (headerUnit === 'days' ? 1 : 7));
}

// "$1,234.50" → { value: 1234.5, cur: 'USD' }
export function parsePrice(v) {
  if (typeof v === 'number') return { value: v, cur: '' };
  const t = String(v || '');
  const m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return { value: m ? parseFloat(m[0]) : 0, cur: cur3(t.replace(/[\d.,\s-]/g, '')) };
}

function num(v) {
  if (typeof v === 'number') return v;
  const m = String(v || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

// ── Header detection ────────────────────────────────────────────
// Checked in this order; each column gets the first field it matches
const FIELD_RX = [
  ['moq',      /\bmoq\b|min(imum)?\.?\s*(order|qty)|כמות מינימ/i],
  ['mult',     /\bspq\b|\bmpq\b|multiple|pack(age)?\s*qty|מכפלה|אריזה/i],
  ['price',    /price|cost|מחיר|עלות/i],
  ['lead',     /lead|l\/t|\blt\b|delivery|weeks|זמן אספקה|אספקה/i],
  ['currency', /curr|מטבע/i],
  ['stock',    /stock|avail|inventory|מלאי/i],
  ['qty',      /qty|quantity|כמות/i],
  ['mpn',      /\bmpn\b|p\/n|\bpn\b|part\s*(no|num|#)|part$|catalog|מק["']?ט|פריט/i],
  ['mfg',      /manufacturer|\bmfr\b|\bmfg\b|brand|make|יצרן/i],
  ['supplier', /supplier|vendor|distributor|source|ספק/i],
];
const PRICE_EXCLUDE = /total|ext|סה["']?כ|target|sell|customer|לקוח|מכירה/i;

function classify(h) {
  const t = String(h || '').trim();
  if (!t) return null;
  for (const [f, rx] of FIELD_RX) {
    if (!rx.test(t)) continue;
    if (f === 'price' && PRICE_EXCLUDE.test(t)) return null;
    // "Manufacturer Part Number" is the MPN, not the manufacturer
    if (f === 'mfg' && /part|p\/n|mpn/i.test(t)) return 'mpn';
    return f;
  }
  return null;
}

function findHeaderRow(aoa) {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const fields = (aoa[i] || []).map(classify);
    if (!fields.includes('price') || !fields.includes('mpn')) continue;
    const score = new Set(fields.filter(Boolean)).size;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

// One sheet as array-of-arrays → offers [{mpn, mfg, supplier, unitPrice, currency, qty, moq, mult, leadDays, stock}]
// Handles a long layout (one row per offer) and a wide QuoteLens-style layout (one block of columns per supplier).
export function parseQuoteSheet(aoa, sheetName) {
  const hr = findHeaderRow(aoa);
  if (hr < 0) return [];
  const head = aoa[hr].map(h => String(h || '').trim());
  const fields = head.map(classify);
  const priceCols = fields.map((f, i) => f === 'price' ? i : -1).filter(i => i >= 0);
  const above = hr > 0 ? aoa[hr - 1] || [] : [];

  // Supplier label per column: wide layouts put the supplier in a (merged) cell above, or in the header text itself
  let label = head.map(() => '');
  if (priceCols.length > 1) {
    let cur = '';
    for (let c = 0; c < head.length; c++) {
      const a = String(above[c] || '').trim();
      if (a) cur = a;
      label[c] = cur;
    }
    if (priceCols.every(c => !label[c])) {
      // No row above: take the supplier from the price header ("Arrow Unit Price" → "Arrow") and carry it right
      cur = '';
      for (let c = 0; c < head.length; c++) {
        if (fields[c] === 'price') cur = head[c].replace(/unit|price|cost|\(.*?\)|usd|\$|€|מחיר|ליח['׳]?/gi, '').replace(/[-_:|]/g, ' ').trim();
        label[c] = cur;
      }
    }
  }

  const common = {}, blocks = new Map();
  fields.forEach((f, c) => {
    if (!f) return;
    const l = label[c];
    if (!l || f === 'mpn' || f === 'mfg') { if (common[f] == null) common[f] = c; return; }
    if (!blocks.has(l)) blocks.set(l, {});
    const b = blocks.get(l);
    if (b[f] == null) b[f] = c;
  });
  const wide = blocks.size > 0;
  if (!wide) blocks.set('', {});
  // In a wide sheet the shared qty column is the requested qty, not a supplier's quoted qty
  const shared = f => !wide || f === 'currency' || f === 'mfg';
  const leadUnit = c => /day|יום|ימים/i.test(head[c] || '') ? 'days' : 'weeks';

  const offers = [];
  let lastMpn = '', lastMfg = '';
  for (let r = hr + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    if (!row.some(v => String(v).trim())) continue;
    const cell = (b, f) => { const c = b[f] != null ? b[f] : shared(f) ? common[f] : null; return c != null ? row[c] : ''; };
    const rawMpn = String(row[common.mpn] || '').trim();
    // merged MPN cells: blank MPN continues the previous part
    const mpn = rawMpn || lastMpn;
    if (rawMpn) { lastMpn = rawMpn; lastMfg = String(cell({}, 'mfg') || '').trim(); }
    if (!mpn) continue;
    for (const [lbl, b] of blocks) {
      const pc = b.price != null ? b.price : common.price;
      if (pc == null) continue;
      const p = parsePrice(row[pc]);
      if (!(p.value > 0)) continue;
      const lc = b.lead != null ? b.lead : shared('lead') ? common.lead : null;
      offers.push({
        mpn,
        mfg: String(cell(b, 'mfg') || '').trim() || lastMfg,
        supplier: lbl || String(cell(b, 'supplier') || '').trim() || sheetName || '',
        unitPrice: p.value,
        currency: cur3(cell(b, 'currency')) || p.cur || cur3(head[pc]) || '',
        qty: num(cell(b, 'qty')) || 0,
        moq: num(cell(b, 'moq')) || 0,
        mult: num(cell(b, 'mult')) || 0,
        leadDays: lc != null ? leadDays(row[lc], leadUnit(lc)) : null,
        stock: num(cell(b, 'stock')) || 0,
      });
    }
  }
  return offers;
}

// ── Matching ────────────────────────────────────────────────────
// Same suffix / prefix rules as matchUpdateToRows (src/import/engine.js), scoped to one pair of part numbers
const stripSfx = s => s.replace(/[-_](ND|CT|DKR|TR|T\/R|1|2|3|4|5|6|CT-ND|DKR-ND)$/, '');
export function mpnMatch(a, b) {
  const x = String(a || '').trim().toUpperCase(), y = String(b || '').trim().toUpperCase();
  if (!x || !y) return false;
  if (x === y || stripSfx(x) === stripSfx(y) || stripSfx(x) === y || x === stripSfx(y)) return true;
  const nx = x.replace(/[\s\-_/.]/g, ''), ny = y.replace(/[\s\-_/.]/g, '');
  if (nx === ny) return true;
  return nx.length >= 5 && ny.length >= 5 && (nx.startsWith(ny) || ny.startsWith(nx));
}

export function matchQuotes(lines, offers) {
  const out = {};
  lines.forEach(l => { out[l.nk] = offers.filter(o => mpnMatch(o.mpn, l.mpn)); });
  return out;
}

// ── Quantities, checks, best pick ───────────────────────────────
export function orderQty(need, offer) {
  let q = Math.max(need || 0, offer.moq || 0);
  if (offer.mult > 1) q = Math.ceil(q / offer.mult) * offer.mult;
  return q;
}

export function arrivalDate(offer, today) {
  if (offer.leadDays == null) return null;
  const d = new Date(today); d.setDate(d.getDate() + offer.leadDays);
  return d;
}

// Online median in the SO currency from verified offers only; null when none
export function onlineMedian(online, toCur, rates) {
  const vals = ((online && online.offers) || []).filter(o => o.verified && o.unitPrice > 0)
    .map(o => fxConvert(o.unitPrice, cur3(o.currency) || 'USD', toCur, rates)).sort((a, b) => a - b);
  if (!vals.length) return null;
  const m = vals.length >> 1;
  return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
}

// Distributor display names, so one distributor seen via several sites groups into one Priority table
const DIST_NAMES = [
  [/digi\s*-?\s*key/i, 'Digi-Key'], [/mouser/i, 'Mouser'], [/arrow/i, 'Arrow'], [/farnell|element\s*14|newark/i, 'Farnell'],
  [/^rs\b|rs\s*(components|online|pro)/i, 'RS'], [/\btme\b/i, 'TME'], [/avnet/i, 'Avnet'], [/future/i, 'Future'], [/tti\b/i, 'TTI'],
];
const SOURCE_NAMES = { digikey: 'Digi-Key', mouser: 'Mouser', octopart: 'Octopart', findchips: 'FindChips' };
export function distName(o) {
  const d = String(o.distributor || '').trim();
  for (const [rx, n] of DIST_NAMES) if (rx.test(d)) return n;
  return d || SOURCE_NAMES[String(o.source || '').toLowerCase()] || String(o.source || 'Online');
}

// Verified online prices → offers in the quote shape, cheapest per distributor
export const ONLINE_SHIP_DAYS = 7; // distributor stock → Israel
export function onlineOffers(online, need) {
  const best = {};
  ((online && online.offers) || []).filter(o => o.verified && +o.unitPrice > 0).forEach(o => {
    const off = {
      mpn: '', mfg: '', supplier: distName(o), unitPrice: +o.unitPrice, currency: cur3(o.currency) || 'USD',
      qty: 0, moq: 0, mult: 0, stock: +o.stock || 0,
      leadDays: +o.stock >= need ? ONLINE_SHIP_DAYS : null,
      online: true, url: String(o.url || ''),
    };
    const cur = best[off.supplier];
    if (!cur || fxConvert(off.unitPrice, off.currency, 'USD') < fxConvert(cur.unitPrice, cur.currency, 'USD')) best[off.supplier] = off;
  });
  return Object.values(best);
}

// line: { mpn, need, price, currency (3-letter), dd: Date|null }
// ctx:  { rates, today, online: {offers:[...]} | undefined }
// → [{ key, level: 'ok'|'warn'|'block'|'info', text }]
export function runChecks(line, offer, ctx) {
  const R = SOPO_RULES, out = [];
  const lineCur = line.currency || 'USD', offCur = offer.currency || 'USD';
  const cost = fxConvert(offer.unitPrice, offCur, lineCur, ctx.rates);

  if (line.price > 0) {
    const m = (line.price - cost) / line.price;
    const pct = (m * 100).toFixed(1) + '%';
    if (m <= 0) out.push({ key: 'margin', level: 'block', text: `הפסד: עלות ${cost.toFixed(4)} ≥ מכירה ${line.price} (${pct})` });
    else if (m < R.minMargin) out.push({ key: 'margin', level: 'warn', text: `מרווח נמוך ${pct}` });
    else out.push({ key: 'margin', level: 'ok', text: `מרווח ${pct}` });
  } else out.push({ key: 'margin', level: 'warn', text: 'אין מחיר מכירה ב-SO' });

  const med = onlineMedian(ctx.online, lineCur, ctx.rates);
  if (med) {
    const ratio = cost / med;
    if (ratio > R.aboveMarket) out.push({ key: 'online', level: 'warn', text: `×${ratio.toFixed(1)} ממחיר השוק (${med.toFixed(4)})` });
    else if (ratio < R.belowMarket) out.push({ key: 'online', level: 'warn', text: `חשוד כזול: ×${ratio.toFixed(2)} ממחיר השוק (${med.toFixed(4)}) — זיוף/טעות?` });
    else out.push({ key: 'online', level: 'ok', text: `בטווח השוק (${med.toFixed(4)})` });
  } else if (ctx.online) out.push({ key: 'online', level: 'info', text: 'אין מחיר אונליין מאומת' });

  if (offer.qty > 0 && offer.qty < line.need) out.push({ key: 'qty', level: 'warn', text: `צוטט ל-${offer.qty} בלבד (נדרש ${line.need})` });
  if (offer.online && offer.stock < line.need) out.push({ key: 'qty', level: 'warn', text: offer.stock ? `מלאי ${offer.stock} בלבד אצל המפיץ` : 'מלאי לא ידוע אצל המפיץ' });
  const q = orderQty(line.need, offer);
  if (q > line.need) out.push({ key: 'qty', level: 'warn', text: `MOQ/אריזה: קנייה של ${q} (+${q - line.need}, ${((q - line.need) * cost).toFixed(2)} ${lineCur})` });

  const arr = arrivalDate(offer, ctx.today);
  if (!arr) out.push({ key: 'lead', level: 'info', text: 'אין זמן אספקה בהצעה' });
  else if (line.dd && arr > line.dd) out.push({ key: 'lead', level: 'warn', text: `יאחר את תאריך הלקוח ב-${Math.round((arr - line.dd) / 86400000)} ימים` });
  else out.push({ key: 'lead', level: 'ok', text: `זמן אספקה ${offer.leadDays} ימים` });
  return out;
}

export const worstLevel = checks => checks.some(c => c.level === 'block') ? 'block' : checks.some(c => c.level === 'warn') ? 'warn' : 'ok';

// Cheapest total cost among offers without a blocking check, then shortest lead; -1 when there are no offers
export function pickBest(line, offers, ctx) {
  if (!offers.length) return -1;
  const scored = offers.map((o, i) => ({
    i,
    block: worstLevel(runChecks(line, o, ctx)) === 'block',
    total: fxConvert(o.unitPrice, o.currency || 'USD', 'ILS', ctx.rates) * orderQty(line.need, o),
    lead: o.leadDays == null ? 9999 : o.leadDays,
  }));
  scored.sort((a, b) => (a.block - b.block) || (a.total - b.total) || (a.lead - b.lead));
  return scored[0].i;
}

// ── Priority paste ──────────────────────────────────────────────
const p2 = n => String(n).padStart(2, '0');
const ddmmyy = d => d ? p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) : '';

// rows: [{ mpn, qty, date: Date|null, unitPrice, currency }]
// Columns: MPN ⇥ — ⇥ Qty ⇥ Delivery date ⇥ — ⇥ — ⇥ Unit price ⇥ Currency
export function toPriorityTSV(rows) {
  return rows.map(r => [
    r.mpn, '', r.qty, ddmmyy(r.date), '', '', +Number(r.unitPrice).toFixed(5), r.currency || 'USD',
  ].join('\t')).join('\r\n');
}
