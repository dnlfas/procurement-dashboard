// SO ↔ PO link report from Priority: each SO line with the PO Priority links to it, sell and buy side side by side
// (unit price, currency, discount, delivery date). Gives the real PO unit price, the sell price and the margin for
// the linked lines. Uploaded in the suppliers view; kept in localStorage and on the server.
import { state } from './state.js';
import { toast } from './utils.js';
import { withXLSX } from './upload.js';
import { cur3 } from './sopo/engine.js';

const KEY = 'oo_sopolink';
let _links = null; // { ts, file, rows: [...] }

const up = v => String(v ?? '').trim().toUpperCase();
const num = v => typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, '')) || 0;
function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number' && v > 1) { const d = new Date(Math.round((v - 25569) * 86400000)); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  if (typeof v === 'string' && v) { const d = new Date(v); if (!isNaN(d)) return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  return null;
}

export function loadLinks() {
  if (_links) return _links;
  try { _links = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (_links) _links.rows.forEach(r => { r.soDd = r.soDd ? new Date(r.soDd) : null; r.buyDd = r.buyDd ? new Date(r.buyDd) : null; });
  return _links;
}

export async function loadLinksFromServer() {
  try {
    const res = await fetch('/api/overrides?doc=sopolink');
    if (!res.ok) return;
    const d = await res.json();
    const cur = loadLinks();
    if (d && d.rows && (!cur || d.ts > cur.ts)) {
      localStorage.setItem(KEY, JSON.stringify(d));
      _links = null; loadLinks();
      if (state.poLoaded) import('./views/supplier.js').then(m => m.renderSuppliers());
    }
  } catch (e) {}
}

// The report repeats column names on the buy side ("כמות", "מחיר ליחידה", "מטבע"…): columns are taken by position,
// sell side before "הזמנת רכש", buy side after it.
export function parseLinkSheet(aoa) {
  const hi = aoa.findIndex(r => (r || []).some(h => String(h).trim() === 'הזמנת רכש'));
  if (hi < 0) return null;
  const h = aoa[hi].map(x => String(x).trim());
  const split = h.indexOf('הזמנת רכש');
  const col = (names, from, to) => { for (let c = from; c < to; c++) if (names.some(n => h[c] === n || h[c].includes(n))) return c; return -1; };
  const S = { so: col(['הזמנת לקוח'], 0, split), custPO: col(['מס\' ההזמנה אצל הלקוח', 'אצל הלקוח'], 0, split), customer: col(['שם לקוח'], 0, split),
    mpn: col(['מק\'ט', 'מקט', 'מספר פריט'], 0, split), desc: col(['תאור', 'תיאור'], 0, split), qty: col(['כמות'], 0, split),
    dd: col(['ת. אספקה'], 0, split), price: col(['מחיר ליחידה'], 0, split), cur: col(['מטבע'], 0, split), disc: col(['הנחה'], 0, split) };
  const B = { supplier: col(['שם ספק'], split, h.length), qty: col(['כמות'], split, h.length), rem: col(['יתרה'], split, h.length),
    dd: col(['ת. אספקה'], split, h.length), price: col(['מחיר ליחידה'], split, h.length), disc: col(['הנחה'], split, h.length) };
  B.cur = B.price >= 0 ? col(['מטבע'], B.price, h.length) : -1;
  if (S.so < 0 || S.mpn < 0 || B.price < 0) return null;
  const get = (r, c) => c >= 0 ? r[c] : '';
  const rows = [];
  for (const r of aoa.slice(hi + 1)) {
    const po = String(r[split] || '').trim();
    const mpn = String(get(r, S.mpn)).trim();
    if (!po || !mpn) continue;
    const net = (p, d) => num(p) * (1 - num(d) / 100);
    rows.push({
      so: String(get(r, S.so)).trim(), custPO: String(get(r, S.custPO)).trim(), customer: String(get(r, S.customer)).trim(), mpn,
      sellPrice: net(get(r, S.price), get(r, S.disc)), sellCur: cur3(get(r, S.cur)) || String(get(r, S.cur)).trim(), soQty: num(get(r, S.qty)), soDd: toDate(get(r, S.dd)),
      po, supplier: String(get(r, B.supplier)).trim(), buyQty: num(get(r, B.qty)), buyRem: num(get(r, B.rem)), buyDd: toDate(get(r, B.dd)),
      buyPrice: net(get(r, B.price), get(r, B.disc)), buyCur: cur3(get(r, B.cur)) || String(get(r, B.cur)).trim(),
    });
  }
  return rows;
}

export function sopoLinkFile(e) {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  withXLSX(async () => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const rows = parseLinkSheet(aoa);
      if (!rows) { toast('⚠ לא זוהה דוח קישור SO↔PO (חסרה עמודת "הזמנת רכש")'); return; }
      const d = { ts: Date.now(), file: file.name, rows };
      localStorage.setItem(KEY, JSON.stringify(d));
      fetch('/api/overrides?doc=sopolink', { method: 'POST', body: JSON.stringify(d), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      _links = null; loadLinks();
      const { renderSuppliers } = await import('./views/supplier.js');
      renderSuppliers();
      toast(`🔗 ${rows.length} שורות PO מקושרות ל-SO נטענו (${new Set(rows.map(r => r.po)).size} הזמנות רכש)`);
    } catch (err) { toast('שגיאה בקריאת הקובץ: ' + err.message); }
  });
}

// SO lines Priority links to this PO line (same PO number and part number)
export function linksFor(poNum, mpn) {
  const L = loadLinks();
  if (!L) return [];
  const p = up(poNum), m = up(mpn);
  return L.rows.filter(r => up(r.po) === p && up(r.mpn) === m);
}

export function linkStatus() {
  const L = loadLinks();
  if (!L) return '';
  const d = new Date(L.ts);
  return `🔗 ${L.rows.length} שורות מקושרות · ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
