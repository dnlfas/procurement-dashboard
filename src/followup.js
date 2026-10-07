import { state, TODAY } from './state.js';
import { syncOverrides } from './persistence.js';
import { fd } from './utils.js';

// Supplier follow-up schedule for open PO lines. Saved to localStorage and synced with the overrides blob
// (key: followups). Per PO line (key: PO__MPN):
//   last     — last contact with the supplier about this line
//   snooze   — don't bring it up before this time
//   promised — new delivery date the supplier gave (yyyymmdd), valid only while the PO report still shows
//              the date it replaced (ddWas); once the ERP date changes, the ERP wins
// Settings: digest (bool) — send a morning push summary
export const FU_KEY = 'oo_followups';
const DAY = 86400000;

export function emptyFollowups() { return { lines: {}, digest: false }; }
export const pk = p => p.poNum + '__' + p.mpn;
export const poLabel = n => /^PO/i.test(n) ? n : 'PO ' + n;
const dKey = d => d ? d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() : 0;
const fromKey = k => k ? new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100) : null;

export function mergeFollowups(a, b) {
  const out = { lines: {}, digest: !!(a.digest || b.digest) };
  [a, b].forEach(f => Object.entries(f.lines || {}).forEach(([k, e]) => {
    const cur = out.lines[k];
    if (!cur) { out.lines[k] = { ...e }; return; }
    const prom = (e.promisedAt || 0) > (cur.promisedAt || 0) ? e : cur;
    out.lines[k] = {
      last: Math.max(cur.last || 0, e.last || 0) || undefined,
      snooze: Math.max(cur.snooze || 0, e.snooze || 0) || undefined,
      promised: prom.promised, promisedAt: prom.promisedAt, ddWas: prom.ddWas,
    };
  }));
  return out;
}

function save() {
  try { localStorage.setItem(FU_KEY, JSON.stringify(state.followups)); } catch(e) {}
  syncOverrides();
}

const entry = p => state.followups.lines[pk(p)] || {};

// Delivery date to plan around: the supplier's new date if still valid, else the PO report date
export function effDate(p) {
  const e = entry(p);
  if (e.promised && e.ddWas === dKey(p.dd)) return fromKey(e.promised);
  return p.dd;
}

export function nextFollowUp(p) {
  const e = entry(p), dd = effDate(p);
  let next;
  if (!dd) next = e.last ? e.last + 14 * DAY : 0;                       // no date: ask for one
  else if (dd < TODAY) next = e.last ? e.last + 3 * DAY : 0;            // overdue: chase every 3 days
  else next = e.last ? Math.max(dd - 2 * DAY, e.last + DAY) : dd - 7 * DAY; // confirm a week before, re-check 2 days before
  if (e.snooze && e.snooze > next) next = e.snooze;
  return next;
}

const endOfDay = t => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };
export const isDue = (p, at = Date.now()) => p.qtyR > 0 && nextFollowUp(p) <= endOfDay(at);

export function lastContact(p) { return entry(p).last || null; }

export function reason(p) {
  const dd = effDate(p);
  if (!dd) return 'אין תאריך אספקה — לבקש תאריך';
  const days = Math.round((dd - TODAY) / DAY);
  const partial = p.qtyS > 0 ? ` · התקבלו ${p.qtyS} מתוך ${p.qtyO}` : '';
  if (days < 0) return `באיחור ${-days} ימים${partial}`;
  return `אישור משלוח — אספקה בעוד ${days} ימים${partial}`;
}

export function markContacted(keys) {
  const now = Date.now();
  keys.forEach(k => { const e = state.followups.lines[k] || {}; delete e.snooze; e.last = now; state.followups.lines[k] = e; });
  save();
}

export function snoozeFollowup(k, days) {
  const until = new Date(); until.setHours(7, 0, 0, 0); until.setDate(until.getDate() + days);
  state.followups.lines[k] = { ...state.followups.lines[k], snooze: until.getTime() };
  save();
}

// value: 'yyyy-mm-dd' from a date input, or '' to clear
export function setPromised(p, value) {
  const k = pk(p), e = { ...state.followups.lines[k] };
  if (value) {
    const [y, m, d] = value.split('-').map(Number);
    Object.assign(e, { promised: y * 10000 + m * 100 + d, promisedAt: Date.now(), ddWas: dKey(p.dd), last: Date.now() });
  } else { delete e.promised; delete e.promisedAt; delete e.ddWas; }
  state.followups.lines[k] = e;
  save();
}

// Drop entries for PO lines no longer in the open-PO report
export function pruneFollowups() {
  if (!state.poLoaded || !state.poRows.length) return;
  const live = new Set(state.poRows.map(pk));
  let changed = false;
  Object.keys(state.followups.lines).forEach(k => { if (!live.has(k)) { delete state.followups.lines[k]; changed = true; } });
  if (changed) save();
}

// Ready-to-send email for one supplier's lines. Hebrew if the supplier name is Hebrew, else English.
export function emailText(supplier, lines) {
  const he = /[֐-׿]/.test(supplier);
  const item = p => {
    const dd = effDate(p), days = dd ? Math.round((dd - TODAY) / DAY) : null;
    const qty = p.qtyS > 0 ? (he ? `${p.qtyR} יח' נותרו מתוך ${p.qtyO}` : `${p.qtyR} remaining of ${p.qtyO}`) : (he ? `כמות ${p.qtyR}` : `Qty ${p.qtyR}`);
    const due = !dd ? (he ? 'ללא תאריך אספקה' : 'no ship date yet')
      : he ? `תאריך אספקה ${fd(dd)}${days < 0 ? ` (באיחור ${-days} ימים)` : ''}`
           : `Due ${fd(dd)}${days < 0 ? ` (${-days} days overdue)` : ''}`;
    return `• ${poLabel(p.poNum)} · ${p.mpn} · ${qty} · ${due}`;
  };
  return he
    ? `שלום,\n\nאשמח לעדכון סטטוס ותאריך משלוח עבור הפריטים הפתוחים הבאים:\n\n${lines.map(item).join('\n')}\n\nתודה,`
    : `Hello,\n\nCould you please confirm the status and shipping date for the following open items:\n\n${lines.map(item).join('\n')}\n\nThank you,`;
}

// ── Morning push summary ─────────────────────────────────────
// Reuses the PO reminder store (/api/po-reminders), which the cron already sends.
// Each time the app renders, the single 'digest' reminder is replaced with one for the next workday 08:00,
// with counts projected to that morning.
const DIGEST_ID = 'digest';

function nextDigestTime() {
  const d = new Date();
  if (d.getHours() >= 8) d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  while (d.getDay() === 5 || d.getDay() === 6) d.setDate(d.getDate() + 1); // Sun–Thu
  return d;
}

let _digestTimer = null;
export function scheduleDigest(extraCounts) {
  if (!state.followups.digest || !state.poLoaded) return;
  clearTimeout(_digestTimer);
  _digestTimer = setTimeout(async () => {
    const at = nextDigestTime();
    const due = state.poRows.filter(p => isDue(p, at.getTime()));
    const supps = new Set(due.map(p => p.supplier)).size;
    const parts = [`📞 ${due.length} מעקבים מול ${supps} ספקים`];
    if (extraCounts.waiting5) parts.push(`⏳ ${extraCounts.waiting5} פריטים ממתינים ל-PO 5+ ימים`);
    if (extraCounts.inbox) parts.push(`📥 ${extraCounts.inbox} חדשים`);
    try {
      const r = await fetch('/api/po-reminders');
      if (!r.ok) return;
      const list = (await r.json()).filter(x => x.id !== DIGEST_ID);
      list.push({ id: DIGEST_ID, label: 'סיכום בוקר', at: at.toISOString(), title: '☀️ לטיפול היום', body: parts.join(' · ') });
      await fetch('/api/po-reminders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(list) });
    } catch(e) {}
  }, 3000);
}

export function setDigest(on) {
  state.followups.digest = on;
  save();
}
