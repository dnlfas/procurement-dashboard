import { state } from './state.js';
import { syncOverrides } from './persistence.js';
import { isShortCovered } from './parse/so.js';

// Remembers SO lines across data loads so the Today tab can show what's new, what changed, and how long
// a line has waited for a PO. Saved to localStorage and synced with the overrides blob (key: tracker).
//   since  — when tracking started; lines already open then aren't "new", and their age comes from the SO date
//   lines  — nk → { first, last, qtyO, dd, chg: { at, qtyO?: [from, to], dd?: [from, to] } }
//   inbox  — nk → { ack, snooze }  (ack: handled at; snooze: hidden until)
export const TRACKER_KEY = 'oo_tracker';
const DAY = 86400000;
const PRUNE_AFTER = 60 * DAY;

export function emptyTracker() { return { since: 0, lines: {}, inbox: {} }; }

export function mergeTracker(a, b) {
  const out = emptyTracker();
  out.since = Math.min(...[a.since, b.since].filter(Boolean)) || 0;
  [a, b].forEach(t => Object.entries(t.lines || {}).forEach(([nk, l]) => {
    const cur = out.lines[nk];
    if (!cur) { out.lines[nk] = { ...l }; return; }
    const newer = (l.last || 0) > (cur.last || 0) ? l : cur;
    out.lines[nk] = { ...newer, first: Math.min(cur.first, l.first) };
  }));
  [a, b].forEach(t => Object.entries(t.inbox || {}).forEach(([nk, e]) => {
    const cur = out.inbox[nk];
    out.inbox[nk] = cur ? { ack: Math.max(cur.ack || 0, e.ack || 0) || undefined, snooze: Math.max(cur.snooze || 0, e.snooze || 0) || undefined } : { ...e };
  }));
  return out;
}

function save() {
  try { localStorage.setItem(TRACKER_KEY, JSON.stringify(state.tracker)); } catch(e) {}
  syncOverrides();
}

const isOpen = r => !['supplied', 'cancelled', 'cancelled_bts'].includes(r.status) && !r.isTemp;
export const needsPO = r => r.cov !== 'green' || isShortCovered(r);
const ddKey = d => d ? d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() : 0;

// Record the current SO lines. Idempotent: reloading the same data changes nothing.
// Skipped until the server copy has loaded, so a failed load can't reset ages and overwrite the server.
export function trackSeen() {
  if (!state.ovrLoaded || !state.allRows.length) return;
  const t = state.tracker;
  const now = Date.now();
  const first = !t.since;
  if (first) t.since = now;
  let changed = first;
  // An SO can list the same MPN on several rows — compare their combined qty and earliest date
  const cur = {};
  state.allRows.filter(isOpen).forEach(r => {
    const dd = state.fieldOvr[r.nk + '__dd'] ? null : ddKey(r.dd); // ignore dates you edited yourself
    const c = cur[r.nk];
    if (!c) cur[r.nk] = { qtyO: r.qtyO, dd };
    else { c.qtyO += r.qtyO; if (dd && (!c.dd || dd < c.dd)) c.dd = dd; }
  });
  Object.entries(cur).forEach(([nk, { qtyO, dd }]) => {
    const l = t.lines[nk];
    if (!l) { t.lines[nk] = { first: now, last: now, qtyO, dd }; changed = true; return; }
    const chg = {};
    if (qtyO !== l.qtyO && l.qtyO != null) chg.qtyO = [l.qtyO, qtyO];
    if (dd && l.dd && dd !== l.dd) chg.dd = [l.dd, dd];
    if (chg.qtyO || chg.dd) { l.chg = { at: now, ...chg }; changed = true; }
    l.qtyO = qtyO;
    if (dd) l.dd = dd;
    if (now - l.last > DAY) { l.last = now; changed = true; } // throttle "last seen" writes to once a day
  });
  Object.keys(t.lines).forEach(nk => { if (now - t.lines[nk].last > PRUNE_AFTER) { delete t.lines[nk]; delete t.inbox[nk]; changed = true; } });
  if (changed) save();
}

// Why a line is in the inbox, or null
export function inboxReason(r) {
  const t = state.tracker, l = t.lines[r.nk];
  if (!l || !isOpen(r)) return null;
  const e = t.inbox[r.nk] || {};
  if (e.snooze && e.snooze > Date.now()) return null;
  if (l.chg && !(e.ack >= l.chg.at)) return { type: 'chg', at: l.chg.at, chg: l.chg };
  if (l.first > t.since && !(e.ack >= l.first) && needsPO(r)) return { type: 'new', at: l.first };
  return null;
}

// Days a line has waited: since it first appeared, or for lines that predate tracking, since the SO date.
// null when neither is known.
export function ageDays(r) {
  const l = state.tracker.lines[r.nk];
  const start = l && l.first > state.tracker.since ? l.first : r.soDate ? r.soDate.getTime() : null;
  return start === null ? null : Math.max(0, Math.floor((Date.now() - start) / DAY));
}

export function ackLine(nk) {
  state.tracker.inbox[nk] = { ack: Date.now() };
  save();
}

export function snoozeLine(nk, days) {
  const until = new Date(); until.setHours(7, 0, 0, 0); until.setDate(until.getDate() + days);
  state.tracker.inbox[nk] = { ...state.tracker.inbox[nk], snooze: until.getTime() };
  save();
}

export function ddFromKey(k) { return k ? new Date(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100) : null; }
