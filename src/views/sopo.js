// SO → PO modal: pick SO lines, load supplier quotes, check them, copy one Priority table per supplier
import { state, TODAY } from '../state.js';
import { esc, fd, toast } from '../utils.js';
import { withXLSX } from '../upload.js';
import {
  DEFAULT_RATES, cur3, fmtCur, parseQuoteSheet, matchQuotes, orderQty, arrivalDate,
  onlineMedian, onlineOffers, runChecks, worstLevel, pickBest, toPriorityTSV, priorityCur, mergeRows, parseCatalogPrices, mpnMatch,
} from '../sopo/engine.js';
import { needsPO } from '../tracker.js';
import { isMOD } from './mod.js';

const SOPO_KEY = 'oo_sopo', FX_KEY = 'oo_fx', PRICE_KEY = 'oo_pricecache';
const PRICE_TTL = 7 * 86400000;
const PRICE_V = 2; // bump when the price check returns new fields (v2: MOQ, more distributors) so older results are re-checked
const CLOSED = ['cancelled', 'cancelled_bts', 'supplied'];
const LVL_CLS = { ok: 'db-g', warn: 'db-o', block: 'db-r', info: 'db-x' };

let S = null;           // current session
let _files = [];        // [{ name, sheets: {name: aoa} }] — kept for "parse with AI"
let _priceCache = null; // { 'MPN|qty': { ts, offers } }

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const offerKey = o => [o.supplier, o.unitPrice, o.currency].join('|');
const quoteKey = o => [o.mpn, o.supplier, o.unitPrice, o.currency].join('|').toUpperCase();
const priceKey = l => l.mpn.trim().toUpperCase() + '|' + l.need;

const isOpenRow = r => !CLOSED.includes(state.statusOvr[r.nk] || r.status);

export function openSOPO(so) {
  const rows = state.allRows.filter(r => r.so === so && isOpenRow(r));
  const cust = rows[0] ? ' · ' + (rows[0].customer || '') : '';
  openSession(so, rows, false, r => r.cov !== 'green' || r.short > 0, `🧾 SO → PO · ${so}${cust}`);
}

// Batch: every open line still waiting for a PO, across all SOs (scope 'mod' / 'other' narrows by customer),
// most urgent first — one set of quotes, one Priority table per supplier with the same part merged across SOs
export function openSOPOBatch(scope) {
  const rows = state.allRows
    .filter(r => !r.isTemp && isOpenRow(r) && needsPO(r) && (scope === 'mod' ? isMOD(r) : scope === 'other' ? !isMOD(r) : true))
    .sort((a, b) => (a.dd || Infinity) - (b.dd || Infinity));
  if (!rows.length) { toast('אין פריטים ממתינים ל-PO'); return; }
  const label = scope === 'mod' ? 'משרד הביטחון' : scope === 'other' ? 'לקוחות אחרים' : 'כל הממתינים';
  const nSO = new Set(rows.map(r => r.so)).size;
  openSession('__batch_' + (scope || 'all'), rows, true, () => true, `🧾 SO → PO מרוכז · ${label} · ${rows.length} שורות מ-${nSO} הזמנות`);
}

function openSession(key, rows, batch, defSel, title) {
  const saved = load(SOPO_KEY, {})[key] || {};
  const lines = rows.map(r => ({
    nk: r.nk, mpn: r.mpn, so: r.so, customer: r.customer || '',
    need: r.short > 0 ? r.short : (r.qtyR || r.qtyO),
    price: r.price || 0, currency: cur3(r.currency) || 'ILS', dd: r.dd || null,
    defSel: !!defSel(r),
  }));
  lines.forEach(l => { l.sel = saved.sel ? saved.sel.includes(l.nk) : l.defSel; });
  S = {
    so: key, batch, filter: '', lines, offers: saved.offers || [], chosen: saved.chosen || {}, manual: saved.manual || {},
    override: saved.override || {}, exclude: saved.exclude || {}, online: {}, openOnline: {}, ready: false, noOnline: !!saved.noOnline,
    rates: { ...DEFAULT_RATES }, fxNote: 'ברירת מחדל',
  };
  _files = [];
  rematch();
  const fx = load(FX_KEY, null);
  if (fx && fx.day === new Date().toDateString()) { S.rates = fx.rates; S.fxNote = fx.note; }
  else loadFX();
  loadPriceCache().then(() => { if (!S) return; applyCachedPrices(S.noOnline); S.ready = true; rematch(); render(); });
  document.getElementById('sopo-title').textContent = title;
  const f = document.getElementById('sopo-filter');
  f.value = ''; f.style.display = batch ? '' : 'none';
  document.getElementById('sopo-modal').style.display = 'flex';
  render();
}

export function closeSOPO() { persist(); document.getElementById('sopo-modal').style.display = 'none'; S = null; }

function persist() {
  if (!S) return;
  const all = load(SOPO_KEY, {});
  all[S.so] = { sel: S.lines.filter(l => l.sel).map(l => l.nk), offers: S.offers, chosen: S.chosen, manual: S.manual, override: S.override, exclude: S.exclude, noOnline: S.noOnline, ts: Date.now() };
  save(SOPO_KEY, all);
}

// ── FX ──────────────────────────────────────────────────────────
async function loadFX() {
  try {
    const res = await fetch('/api/parse-update', { method: 'POST', body: JSON.stringify({ type: 'fx' }), headers: { 'Content-Type': 'application/json' } });
    const j = await res.json();
    if (!res.ok || !j.ok) throw new Error(j.error || res.status);
    S.rates = { ...DEFAULT_RATES, ...j.rates };
    S.fxNote = 'בנק ישראל' + (j.date ? ' ' + String(j.date).slice(0, 10) : '');
    save(FX_KEY, { day: new Date().toDateString(), rates: S.rates, note: S.fxNote });
  } catch (e) { S.fxNote = 'ברירת מחדל — עדכן ידנית'; }
  render();
}

export function sopoRate(cur, v) {
  const n = parseFloat(v);
  if (!(n > 0)) return;
  S.rates[cur] = n; S.fxNote = 'ידני';
  save(FX_KEY, { day: new Date().toDateString(), rates: S.rates, note: S.fxNote });
  render();
}

// ── Quotes ──────────────────────────────────────────────────────
function rematch() {
  const m = matchQuotes(S.lines, S.offers);
  S.lines.forEach(l => {
    l.offers = (m[l.nk] || []).concat(onlineOffers(S.online[l.nk], l.need));
    // online offers are part of the choice, so wait for the price cache before changing picks
    if (!S.ready || S.chosen[l.nk] === 'manual') return;
    // keep the user's pick if that offer still exists, else take the best one
    if (!l.offers.some(o => offerKey(o) === S.chosen[l.nk])) {
      const bi = pickBest(lineCtx(l), l.offers, ctxFor(l));
      if (bi >= 0) S.chosen[l.nk] = offerKey(l.offers[bi]); else delete S.chosen[l.nk];
    }
  });
}

export function sopoQuoteFiles(e) {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  withXLSX(async () => {
    let added = 0, catalog = 0;
    for (const file of files) {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: true });
      const base = file.name.replace(/\.[^.]+$/, '');
      const sheets = {};
      let offers = [];
      wb.SheetNames.forEach(n => {
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true, blankrows: true });
        const curs = cellCurrencies(wb.Sheets[n], aoa);
        // for the AI: numbers whose cell format shows a currency get it spelled out ("5" → "5 USD")
        sheets[n] = aoa.map((row, r) => row.map((v, c) => typeof v === 'number' && curs[r][c] ? `${v} ${curs[r][c]}` : v));
        // generic sheet names fall back to the file name as the supplier
        const label = /^(sheet|גיליון)\s*\d*$/i.test(n.trim()) ? base : n;
        offers = offers.concat(parseQuoteSheet(aoa, label, curs));
        catalog += preloadCatalog(parseCatalogPrices(aoa, curs), file.name);
      });
      _files.push({ name: file.name, sheets });
      // the same offer on several sheets (e.g. QuoteLens "Good Lines" repeats the audit), or a file loaded twice, counts once
      const seen = new Set(S.offers.map(quoteKey));
      offers = offers.filter(o => !seen.has(quoteKey(o)) && seen.add(quoteKey(o)));
      if (offers.length) { S.offers = S.offers.concat(offers); added += offers.length; }
      else { toast(`${file.name}: לא זוהו עמודות — מנתח עם AI...`); added += await aiParse({ name: file.name, sheets }); }
    }
    if (catalog) savePriceCache();
    rematch(); persist(); render();
    toast(`📊 ${added} הצעות נטענו` + (catalog ? ` · 🌐 ${catalog} מחירי קטלוג מהקובץ (ללא בדיקת AI)` : ''));
  });
}

// Catalog prices from the quote file become a line's online prices when it has none yet, so the AI online check
// skips it. Saved to the shared price cache like a real check (7 days); a later AI check only runs if it expires.
function preloadCatalog(prices, fileName) {
  if (!prices.length) return 0;
  let n = 0;
  S.lines.forEach(l => {
    if (S.online[l.nk]) return;
    const seen = new Set();
    const hits = prices.filter(p => mpnMatch(l.mpn, p.mpn) && !seen.has(p.distributor + '|' + p.unitPrice) && seen.add(p.distributor + '|' + p.unitPrice));
    if (!hits.length) return;
    const entry = {
      v: PRICE_V, ts: Date.now(), file: fileName,
      offers: hits.map(p => ({ source: 'Excel', distributor: p.distributor, url: '', unitPrice: p.unitPrice, currency: p.currency, priceBreakQty: 0, moq: 0, mult: 0, stock: 0, verified: true })),
    };
    S.online[l.nk] = entry;
    if (_priceCache) _priceCache[priceKey(l)] = entry;
    n++;
  });
  return n;
}

function savePriceCache() {
  if (!_priceCache) return;
  // keep the cache small: drop expired entries before saving
  Object.keys(_priceCache).forEach(k => { if (Date.now() - _priceCache[k].ts > PRICE_TTL) delete _priceCache[k]; });
  save(PRICE_KEY, _priceCache);
  fetch('/api/overrides?doc=pricecache', { method: 'POST', body: JSON.stringify(_priceCache), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
}

// Grid aligned with sheet_to_json(header:1) rows: the currency each cell's number format displays, '' when none
function cellCurrencies(ws, aoa) {
  const s = XLSX.utils.decode_range(ws['!ref'] || 'A1').s;
  return aoa.map((row, r) => row.map((_, c) => { const cell = ws[XLSX.utils.encode_cell({ r: r + s.r, c: c + s.c })]; return cell && cell.t === 'n' ? fmtCur(cell.z) : ''; }));
}

async function aiParse(f) {
  const content = JSON.stringify(Object.fromEntries(Object.entries(f.sheets).map(([n, a]) => [n, a.slice(0, 400)])));
  try {
    const res = await fetch('/api/parse-update', { method: 'POST', body: JSON.stringify({ type: 'quote', content }), headers: { 'Content-Type': 'application/json' } });
    const j = await res.json();
    if (!res.ok || !j.ok) throw new Error(j.error || res.status);
    const offers = (j.offers || []).map(o => ({
      mpn: String(o.mpn || ''), mfg: String(o.mfg || ''), supplier: String(o.supplier || f.name.replace(/\.[^.]+$/, '')),
      unitPrice: +o.unitPrice || 0, currency: cur3(o.currency), qty: +o.qty || 0, moq: +o.moq || 0, mult: +o.mult || 0,
      leadDays: o.leadDays == null || o.leadDays === '' ? null : +o.leadDays, stock: 0,
    })).filter(o => o.mpn && o.unitPrice > 0);
    S.offers = S.offers.concat(offers);
    if (j.truncated) toast('⚠ הקובץ ארוך — ייתכן שחלק מההצעות חסרות');
    return offers.length;
  } catch (e) { toast('שגיאת AI: ' + e.message); return 0; }
}

// Re-read the uploaded files with AI, replacing what the column mapping found
export async function sopoAIParse() {
  if (!_files.length) { toast('העלה קודם קובץ הצעות'); return; }
  const btn = document.getElementById('sopo-ai'); btn.disabled = true; btn.textContent = 'מנתח...';
  S.offers = [];
  let n = 0;
  for (const f of _files) n += await aiParse(f);
  btn.disabled = false; btn.textContent = '✨ נתח עם AI';
  rematch(); persist(); render();
  toast(`✨ ${n} הצעות זוהו ע"י AI`);
}

// Start over: no quotes, online prices, picks, manual prices, overrides or exclusions; default line selection.
// Catalog prices that came from a quote file are deleted. AI-checked prices stay in the 7-day cache (they cost
// credits) but are hidden until "online check" is pressed again, which brings them back without new AI calls.
export function sopoClearQuotes() {
  if (!confirm('לנקות הכל ולהתחיל מחדש? ההצעות, מחירי האונליין, בחירות הספקים, המחירים הידניים והסימונים יימחקו.')) return;
  if (_priceCache) {
    S.lines.forEach(l => { const c = _priceCache[priceKey(l)]; if (c && c.file) delete _priceCache[priceKey(l)]; });
    savePriceCache();
  }
  S.online = {}; S.noOnline = true;
  S.offers = []; S.chosen = {}; S.manual = {}; S.override = {}; S.exclude = {}; S.openOnline = {}; _files = [];
  S.lines.forEach(l => { l.sel = l.defSel; });
  S.filter = ''; document.getElementById('sopo-filter').value = '';
  rematch(); persist(); render();
  toast('↺ SO → PO אופס');
}

// ── Online price check ──────────────────────────────────────────
async function loadPriceCache() {
  if (_priceCache) return;
  _priceCache = load(PRICE_KEY, {});
  try {
    const res = await fetch('/api/overrides?doc=pricecache');
    if (res.ok) Object.assign(_priceCache, await res.json());
  } catch (e) {}
}

// fileOnly: after "clear all", only catalog prices from a quote file uploaded since then
function applyCachedPrices(fileOnly) {
  if (!S) return;
  S.lines.forEach(l => {
    const c = _priceCache[priceKey(l)];
    if (c && (!fileOnly || c.file) && c.v >= PRICE_V && Date.now() - c.ts < PRICE_TTL) S.online[l.nk] = c;
  });
}

export async function sopoOnline() {
  // after "clear all": cached results come back first, free; only parts without one go to the AI
  if (S.noOnline) { S.noOnline = false; await loadPriceCache(); applyCachedPrices(); rematch(); persist(); render(); }
  // lines with the same part and quantity (common in batch mode) share one lookup
  const byKey = {};
  S.lines.filter(l => l.sel && !S.online[l.nk]).forEach(l => { (byKey[priceKey(l)] = byKey[priceKey(l)] || []).push(l); });
  const todo = Object.values(byKey).map(ls => ls[0]);
  if (!todo.length) { toast('כל השורות המסומנות כבר נבדקו (7 ימים אחרונים)'); return; }
  if (todo.length > 30 && !confirm(`לבדוק ${todo.length} פריטים אונליין? זה ייקח כמה דקות ויעלה בקריאות AI.\nכדי לצמצם — סנן ובטל סימון לפריטים שאינם קטלוגיים.`)) return;
  const btn = document.getElementById('sopo-online'); btn.disabled = true;
  const batches = [];
  for (let i = 0; i < todo.length; i += 2) batches.push(todo.slice(i, i + 2));
  let done = 0, failed = 0;
  btn.textContent = `🌐 בודק 0/${todo.length}...`;
  const run = async batch => {
    const parts = batch.map(l => ({ mpn: l.mpn, mfg: (chosenOffer(l) || {}).mfg || '', qty: l.need }));
    try {
      const res = await fetch('/api/parse-update', { method: 'POST', body: JSON.stringify({ type: 'pricecheck', content: JSON.stringify(parts) }), headers: { 'Content-Type': 'application/json' } });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || res.status);
      batch.forEach(l => {
        const p = (j.parts || []).find(x => String(x.mpn || '').toUpperCase() === l.mpn.toUpperCase()) || { offers: [] };
        const entry = { v: PRICE_V, ts: Date.now(), offers: p.offers || [] };
        _priceCache[priceKey(l)] = entry;
        if (S) byKey[priceKey(l)].forEach(x => { S.online[x.nk] = entry; });
      });
    } catch (e) { failed += batch.length; }
    done += batch.length;
    btn.textContent = `🌐 בודק ${done}/${todo.length}...`;
    if (S) { rematch(); persist(); render(); }
  };
  // three requests at a time
  const queue = [...batches];
  await Promise.all([0, 1, 2].map(async () => { while (queue.length) await run(queue.shift()); }));
  savePriceCache();
  btn.disabled = false; btn.textContent = '🌐 בדיקת מחיר אונליין';
  if (failed) toast(`⚠ ${failed} פריטים לא נבדקו — נסה שוב`);
  if (S) { rematch(); persist(); render(); }
}

// ── RFQ table ───────────────────────────────────────────────────
// Selected lines → MPN / Quantity, copied as a table for a new RFQ email.
// The same part on several lines (batch mode) is one row with the combined quantity.
function rfqRows() {
  const rows = [], by = {};
  S.lines.filter(l => l.sel).forEach(l => {
    const k = String(l.mpn).trim().toUpperCase();
    if (by[k]) { by[k].qty += l.need; return; }
    rows.push(by[k] = { mpn: l.mpn.trim(), qty: l.need });
  });
  return rows;
}

export async function sopoRFQ() {
  const rows = rfqRows();
  if (!rows.length) { toast('סמן שורות לטבלת RFQ'); return; }
  const table = rows.map(r => [r.mpn, r.qty]);
  const head = ['MPN', 'Quantity'];
  const td = (v, h) => `<${h ? 'th' : 'td'} style="border:1px solid #999;padding:4px 8px;text-align:left;color:#000;${h ? 'background:#e8eef7;' : ''}">${esc(String(v))}</${h ? 'th' : 'td'}>`;
  const html = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:10pt" dir="ltr"><tr>${head.map(h => td(h, true)).join('')}</tr>`
    + table.map(r => `<tr>${r.map(v => td(v)).join('')}</tr>`).join('') + '</table>';
  const tsv = [head, ...table].map(r => r.join('\t')).join('\r\n');
  try {
    if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([tsv], { type: 'text/plain' }) })]);
    else await navigator.clipboard.writeText(tsv);
    toast(`📧 טבלת RFQ עם ${table.length} פריטים הועתקה — הדבק במייל חדש`);
  } catch (e) {
    toast('⚠ ההעתקה ללוח נכשלה');
  }
}

export function sopoShowOnline(i) { const l = S.lines[i]; S.openOnline[l.nk] = !S.openOnline[l.nk]; render(); }

// ── Line edits ──────────────────────────────────────────────────
export function sopoToggle(i, v) { S.lines[i].sel = v; persist(); render(); }
// "Select all" / "clear" act on the lines the filter shows
export function sopoToggleAll(v) { S.lines.filter(shown).forEach(l => { l.sel = v; }); persist(); render(); }
let _filterT = 0;
export function sopoFilter(v) { clearTimeout(_filterT); _filterT = setTimeout(() => { if (S) { S.filter = v.trim().toUpperCase(); render(); } }, 200); }
const shown = l => !S.filter || [l.mpn, l.so, l.customer, (chosenOffer(l) || {}).supplier].some(x => String(x || '').toUpperCase().includes(S.filter));
export function sopoPick(i, v) { S.chosen[S.lines[i].nk] = v; persist(); render(); }
export function sopoOverride(i, v) { S.override[S.lines[i].nk] = v; persist(); render(); }
export function sopoManual(i, field, v) {
  const nk = S.lines[i].nk;
  const m = S.manual[nk] = S.manual[nk] || { supplier: '', unitPrice: 0, currency: 'USD', leadDays: null };
  if (field === 'unitPrice') m.unitPrice = parseFloat(v) || 0;
  else if (field === 'leadWeeks') m.leadDays = v === '' ? null : Math.round(parseFloat(v) * 7);
  else m[field] = field === 'currency' ? cur3(v) || 'USD' : v.trim();
  persist(); render();
}

function chosenOffer(l) {
  const k = S.chosen[l.nk];
  if (k === 'manual') { const m = S.manual[l.nk]; return m && m.supplier && m.unitPrice > 0 ? { ...m, mfg: '', qty: 0, moq: 0, mult: 0 } : null; }
  return (l.offers || []).find(o => offerKey(o) === k) || null;
}
const lineCtx = l => ({ mpn: l.mpn, need: l.need, price: l.price, currency: l.currency, dd: l.dd });
const ctxFor = l => ({ rates: S.rates, today: TODAY, online: S.online[l.nk] });

// ── Render ──────────────────────────────────────────────────────
const money = (v, c) => (+v).toLocaleString('en-US', { maximumFractionDigits: 5 }) + ' ' + (c || '');
const badge = c => `<span class="db ${LVL_CLS[c.level]}" title="${esc(c.text)}">${esc(c.text)}</span>`;

function render() {
  if (!S) return;
  document.getElementById('sopo-fx').innerHTML = ['USD', 'EUR', 'GBP'].map(c =>
    `<label>${c} <input type="number" step="0.0001" value="${S.rates[c]}" onchange="sopoRate('${c}',this.value)"></label>`).join('')
    + `<span class="sopo-muted">₪ ליחידה · ${esc(S.fxNote)}</span>`;
  document.getElementById('sopo-quote-info').textContent = S.offers.length
    ? `${S.offers.length} הצעות מ-${new Set(S.offers.map(o => o.supplier)).size} ספקים` : 'טרם נטענו הצעות';

  const rows = S.lines.map((l, i) => {
    if (!shown(l)) return '';
    const off = chosenOffer(l);
    const checks = off ? runChecks(lineCtx(l), off, ctxFor(l)) : [];
    const lvl = off ? worstLevel(checks) : 'none';
    const opts = (l.offers || []).map(o => {
      const k = offerKey(o);
      const lt = o.leadDays == null ? ' · זמן אספקה ?' : o.leadDays === 0 && !o.online ? ' · במלאי' : ` · ${o.leadDays}י׳`;
      const moq = o.moq ? ` · MOQ ${o.moq}` : '';
      const stk = o.online ? ` · מלאי ${o.stock || '?'}` : '';
      return `<option value="${esc(k)}" ${S.chosen[l.nk] === k ? 'selected' : ''}>${o.online ? '🌐 ' : ''}${esc(o.supplier)} — ${money(o.unitPrice, o.currency)}${moq}${stk}${lt}</option>`;
    }).join('');
    const pick = `<select class="sopo-sel" onchange="sopoPick(${i},this.value)">
      <option value="" ${!S.chosen[l.nk] ? 'selected' : ''}>${l.offers && l.offers.length ? '— בחר ספק —' : '— אין הצעה —'}</option>${opts}
      <option value="manual" ${S.chosen[l.nk] === 'manual' ? 'selected' : ''}>✏ ידני...</option></select>`;
    const m = S.manual[l.nk] || {};
    const manual = S.chosen[l.nk] === 'manual' ? `<div class="sopo-manual">
      <input placeholder="ספק" value="${esc(m.supplier || '')}" onchange="sopoManual(${i},'supplier',this.value)">
      <input type="number" step="any" placeholder="מחיר" value="${m.unitPrice || ''}" onchange="sopoManual(${i},'unitPrice',this.value)">
      <input placeholder="USD" value="${esc(m.currency || 'USD')}" onchange="sopoManual(${i},'currency',this.value)" style="width:48px">
      <input type="number" step="any" placeholder="שבועות" value="${m.leadDays == null ? '' : m.leadDays / 7}" onchange="sopoManual(${i},'leadWeeks',this.value)" style="width:64px"></div>` : '';
    const on = S.online[l.nk];
    const med = on ? onlineMedian(on, l.currency, S.rates) : null;
    const nVer = on ? on.offers.filter(o => o.verified).length : 0;
    const onCell = on ? `<button class="sopo-link" onclick="sopoShowOnline(${i})" title="${nVer} מקורות מאומתים מתוך ${on.offers.length}">🌐 ${med ? money(med.toFixed(4), l.currency) : 'אין מאומת'}</button>` : '';
    const onDet = on && S.openOnline[l.nk] ? `<tr class="sopo-det"><td></td><td colspan="7">${on.offers.length ? on.offers.map(o =>
      `<div class="${o.verified ? '' : 'sopo-unver'}">${o.verified ? '✓' : '✗ לא מאומת'} ${esc(o.distributor || o.source)} — ${money(o.unitPrice, o.currency)}${o.priceBreakQty ? ' @' + o.priceBreakQty : ''}${o.moq > 1 ? ' · MOQ ' + o.moq : ''}${o.stock ? ' · מלאי ' + o.stock : ''} · ${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.source || 'link')}</a>` : esc(o.source || '')}</div>`).join('')
      : 'לא נמצא מחיר אונליין'} <span class="sopo-muted">${on.file ? `מחיר קטלוג מהקובץ ${esc(on.file)} · ${fd(new Date(on.ts))}` : `נבדק ${fd(new Date(on.ts))}`}</span></td></tr>` : '';
    const ovr = lvl === 'block' ? `<label class="sopo-ovr"><input type="checkbox" ${S.override[l.nk] ? 'checked' : ''} onchange="sopoOverride(${i},this.checked)"> כלול בכל זאת</label>` : '';
    const qty = off ? orderQty(l.need, off) : l.need;
    return `<tr class="sopo-l-${lvl}${l.sel ? '' : ' sopo-off'}">
      <td><input type="checkbox" ${l.sel ? 'checked' : ''} onchange="sopoToggle(${i},this.checked)"></td>
      <td class="mpn">${esc(l.mpn)}${S.batch ? `<div class="sopo-so" title="${esc(l.customer)}">${esc(l.so)} · ${esc(l.customer.slice(0, 22))}</div>` : ''}</td>
      <td>${l.need}${qty !== l.need ? ` <span class="sopo-muted">→ ${qty}</span>` : ''}</td>
      <td>${l.price ? money(l.price, l.currency) : '—'}</td>
      <td>${fd(l.dd)}</td>
      <td>${pick}${manual}</td>
      <td>${onCell}</td>
      <td>${checks.map(badge).join('')}${ovr}</td>
    </tr>${onDet}`;
  }).join('');
  const nShown = S.lines.filter(shown).length;
  document.getElementById('sopo-lines').innerHTML = rows
    || `<tr><td colspan="8" class="sopo-muted">${S.lines.length ? 'אין שורות שמתאימות לסינון' : 'אין שורות פתוחות בהזמנה'}</td></tr>`;
  document.getElementById('sopo-count').textContent = `${S.lines.filter(l => l.sel).length} מסומנות`
    + (nShown < S.lines.length ? ` · מוצגות ${nShown}/${S.lines.length}` : '');
  renderGroups();
}

// Every selected line with a supplier goes into its supplier's table; blocked lines start unchecked with their reason
function exportRows() {
  const groups = {}, skipped = [];
  S.lines.forEach((l, i) => {
    if (!l.sel) return;
    const off = chosenOffer(l);
    if (!off) { skipped.push(`${l.mpn} (ללא ספק)`); return; }
    const checks = runChecks(lineCtx(l), off, ctxFor(l));
    const blocked = worstLevel(checks) === 'block';
    (groups[off.supplier] = groups[off.supplier] || []).push({
      i, so: l.so, mpn: l.mpn, need: l.need, offer: off, qty: orderQty(l.need, off), date: arrivalDate(off, TODAY) || l.dd,
      unitPrice: off.unitPrice, currency: off.currency || 'USD',
      blocked, on: blocked ? !!S.override[l.nk] : !S.exclude[l.nk],
      // the MOQ note is worked out per table row (merged rows round up once), not per SO line
      reason: checks.filter(c => c.level === (blocked ? 'block' : 'warn') && !(c.key === 'qty' && c.text.startsWith('MOQ'))).map(c => c.text).join(' · '),
      online: !!off.online, url: off.url || '',
    });
  });
  Object.keys(groups).forEach(n => { groups[n] = mergeRows(groups[n]); });
  return { groups, skipped };
}

function renderGroups() {
  const { groups, skipped } = exportRows();
  const names = Object.keys(groups).sort();
  const html = names.map((n, gi) => {
    const rows = groups[n], on = rows.filter(r => r.on);
    const tot = {};
    on.forEach(r => { tot[r.currency] = (tot[r.currency] || 0) + r.qty * r.unitPrice; });
    const online = rows.some(r => r.online);
    const nSO = new Set(on.flatMap(r => r.sos)).size;
    return `<div class="sopo-grp">
      <div class="sopo-grp-h"><b>${online ? '🌐 ' : ''}${esc(n)}</b><span class="sopo-muted">${on.length}/${rows.length} שורות${S.batch && on.length ? ` · ${nSO} הזמנות` : ''}${on.length ? ' · ' + Object.entries(tot).map(([c, v]) => money(v.toFixed(2), c)).join(' + ') : ''}</span>
        <button class="btn btn-blue" onclick="sopoCopy(${gi})" ${on.length ? '' : 'disabled'}>📋 העתק ל-Priority</button></div>
      <table class="import-tbl sopo-tsv"><tbody>${rows.map(r => `<tr class="${r.blocked ? 'sopo-l-block' : ''}${r.on ? '' : ' sopo-off'}">
        <td><input type="checkbox" ${r.on ? 'checked' : ''} onchange="sopoInclude('${r.idx.join(',')}',this.checked)" title="${r.blocked ? 'חסום — סמן כדי לכלול בכל זאת' : 'כלול בהעתקה'}"></td>
        <td>${esc(r.mpn)}</td><td></td><td>${r.qty}</td><td>${fd(r.date)}</td><td></td><td></td><td>${+Number(r.unitPrice).toFixed(5)}</td><td>${esc(priorityCur(r.currency))}</td>${online ? `<td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">🔗</a>` : ''}</td>` : ''}
        ${S.batch ? `<td class="sopo-reason sopo-muted" title="${esc(r.sos.join(', '))}">${r.idx.length > 1 ? `⊕ ${r.idx.length} שורות: ` : ''}${esc(r.sos.slice(0, 3).join(', '))}${r.sos.length > 3 ? ` +${r.sos.length - 3}` : ''}</td>` : ''}
        <td class="sopo-reason">${r.reason ? `<span class="db ${r.blocked ? 'db-r' : 'db-o'}">${esc(r.reason)}</span>` : ''}${r.qty > r.need ? `<span class="db db-o" title="נדרש ${r.need}, MOQ/אריזה מעגל ל-${r.qty}">MOQ: +${r.qty - r.need}</span>` : ''}</td></tr>`).join('')}</tbody></table>
    </div>`;
  }).join('');
  document.getElementById('sopo-groups').innerHTML = (html || '<div class="sopo-muted">בחר ספק לשורות כדי לבנות טבלאות</div>')
    + (skipped.length ? `<div class="sopo-skip">לא נכללו: ${skipped.map(esc).join(' · ')}</div>` : '');
}

// Table checkbox: for a blocked line it is the "include anyway" override, otherwise an exclude.
// idx: the SO line indexes behind one table row ("3" or "3,8,12" when merged)
export function sopoInclude(idx, v) {
  String(idx).split(',').map(Number).forEach(i => {
    const l = S.lines[i];
    const off = chosenOffer(l);
    const blocked = off && worstLevel(runChecks(lineCtx(l), off, ctxFor(l))) === 'block';
    if (blocked) S.override[l.nk] = v; else if (v) delete S.exclude[l.nk]; else S.exclude[l.nk] = true;
  });
  persist(); render();
}

export async function sopoCopy(gi) {
  const { groups } = exportRows();
  const n = Object.keys(groups).sort()[gi];
  if (!n) return;
  const rows = groups[n].filter(r => r.on);
  if (!rows.length) return;
  try { await navigator.clipboard.writeText(toPriorityTSV(rows)); toast(`📋 ${rows.length} שורות ל-${n} הועתקו — הדבק בשורות ההזמנה ב-Priority`); }
  catch (e) { toast('ההעתקה נכשלה'); }
}
