import { state, TODAY, NK } from '../state.js';
import { esc, fd, p2, autoH, expandNotes, toast } from '../utils.js';
import { calcG, isShortCovered } from '../parse/so.js';
import { saveField, saveStatus, saveNote } from '../persistence.js';
import { trackSeen, inboxReason, ageDays, needsPO, ackLine, snoozeLine, ddFromKey } from '../tracker.js';
import { isMOD } from './mod.js';
import { pk, poLabel, isDue, effDate, reason, lastContact, markContacted, snoozeFollowup, setPromised, pruneFollowups, emailText, scheduleDigest, setDigest } from '../followup.js';

const shortCust = c => (c || '').replace(/\(.*?\)/g, '').replace(/בע"מ/g, '').trim().slice(0, 18);

// Today tab: inbox (new / changed lines to acknowledge) + lines still waiting for a PO, oldest first
export function renderToday() {
  trackSeen();
  const open = state.allRows.filter(r => !['supplied', 'cancelled', 'cancelled_bts'].includes(r.status) && !r.isTemp);

  const inbox = open.map(r => ({ r, why: inboxReason(r) })).filter(x => x.why).sort((a, b) => b.why.at - a.why.at);
  const inboxNks = new Set(inbox.map(x => x.r.nk));
  document.getElementById('inbox-count').textContent = inbox.length ? '(' + inbox.length + ')' : '';
  document.getElementById('inbox-list').innerHTML = inbox.length
    ? inbox.map(({ r, why }) => inboxItem(r, why)).join('')
    : `<div class="empty" style="padding:18px">✓ אין פריטים חדשים לטיפול</div>`;

  const waiting = open.filter(r => needsPO(r) && !inboxNks.has(r.nk)).map(r => ({ r, age: ageDays(r) }));
  const mod = waiting.filter(x => isMOD(x.r)), other = waiting.filter(x => !isMOD(x.r));
  document.getElementById('aging-count').textContent = '(' + waiting.length + ')';
  document.getElementById('aging-mod-count').textContent = '(' + mod.length + ')';
  document.getElementById('aging-other-count').textContent = '(' + other.length + ')';
  document.getElementById('aging-mod-list').innerHTML = agingList(mod);
  document.getElementById('aging-other-list').innerHTML = agingList(other);

  renderFollowups();
  scheduleDigest({ inbox: inbox.length, waiting5: waiting.filter(x => x.age >= 5).length });

  const et1 = document.getElementById('et1');
  if (et1) et1.textContent = '🔴 לטיפול היום' + (inbox.length ? ' (' + inbox.length + ')' : '');
  document.getElementById('emp-stat').textContent = `${inbox.length} חדשים · ${waiting.length} ממתינים ל-PO · ${state.allRows.length} פריטים סה"כ`;
}

// Waiting-for-PO lines grouped by age, oldest first; lines of unknown age in a collapsed group
function agingList(waiting) {
  const byOldest = (a, b) => b.age - a.age || (a.r.dd || 0) - (b.r.dd || 0);
  const byDue = (a, b) => (a.r.dd || Infinity) - (b.r.dd || Infinity);
  const groups = [
    { title: '5+ ימים ללא PO', cls: 'ti-red', items: waiting.filter(x => x.age >= 5).sort(byOldest) },
    { title: '2–4 ימים', cls: 'ti-ora', items: waiting.filter(x => x.age >= 2 && x.age < 5).sort(byOldest) },
    { title: 'חדשים (0–1 ימים)', cls: 'ti-grey', items: waiting.filter(x => x.age !== null && x.age < 2).sort(byOldest) },
  ];
  const old = waiting.filter(x => x.age === null).sort(byDue);
  return groups.filter(g => g.items.length).map(g =>
      `<div class="aging-hdr">${g.title} · ${g.items.length}</div>` + g.items.slice(0, 40).map(x => agingItem(x.r, x.age, g.cls)).join('')
      + (g.items.length > 40 ? `<div class="more-hint">+ ${g.items.length - 40} נוספים — ראה "כל ההזמנות" עם סינון "לא מכוסים"</div>` : '')
    ).join('')
    + (old.length ? `<details class="aging-old"><summary class="aging-hdr" title="פריטים ללא תאריך הזמנה בקובץ ה-SO, שהיו פתוחים כבר כשהמעקב התחיל (${fd(new Date(state.tracker.since))})">גיל לא ידוע · ${old.length}</summary>`
        + old.slice(0, 50).map(x => agingItem(x.r, null, 'ti-grey')).join('')
        + (old.length > 50 ? `<div class="more-hint">+ ${old.length - 50} פריטים נוספים — ראה "כל ההזמנות" עם סינון "לא מכוסים"</div>` : '')
        + '</details>' : '')
    || `<div class="empty" style="padding:18px">✓ כל הפריטים מכוסים בהזמנות רכש</div>`;
}

function lineMeta(r) {
  return `<span class="ti-cust" title="${esc(r.customer)}">${esc(shortCust(r.customer))}</span>
      <span class="ti-so badge-link" onclick="openSOInEmp('${esc(r.so)}')" title="פתח הזמנה">${esc(r.so)}</span>`;
}

function dueBadge(r) {
  if (!r.dd) return '<span></span>';
  if (r.isOvr) return `<span class="db ${r.daysOvr > 30 ? 'db-r' : 'db-o'}" title="תאריך אספקה ללקוח ${fd(r.dd)} — ${r.daysOvr} ימים באיחור">${r.daysOvr}י׳ איחור</span>`;
  return `<span class="ti-so" title="תאריך אספקה ללקוח">${fd(r.dd)}</span>`;
}

function inboxItem(r, why) {
  let reason;
  if (why.type === 'new') reason = `<span class="db db-b" title="הופיע לראשונה ${fd(new Date(why.at))}">חדש</span>`;
  else {
    const parts = [];
    if (why.chg.qtyO) parts.push(`כמות ${why.chg.qtyO[0]}→${why.chg.qtyO[1]}`);
    if (why.chg.dd) parts.push(`תאריך ${fd(ddFromKey(why.chg.dd[0]))}→${fd(ddFromKey(why.chg.dd[1]))}`);
    reason = `<span class="db db-p" title="השתנה בנתוני ה-SO ב-${fd(new Date(why.at))}">${parts.join(' · ')}</span>`;
  }
  const nk = esc(r.nk).replace(/'/g, "\'");
  return `<div class="today-item inbox-item ${why.type === 'new' ? 'ti-new' : 'ti-chg'}">
      <div class="ti-mpn" title="${esc(r.desc || r.mpn)}">${esc(r.mpn)}</div>
      ${reason}
      <span class="ti-so" title="יתרה לאספקה">×${r.qtyR || r.qtyO}</span>
      ${dueBadge(r)}
      ${lineMeta(r)}
      <span class="inbox-acts">
        <button class="btn btn-ghost" onclick="ackInbox('${nk}')" title="טופל — הסר מהתיבה. אם עדיין אין PO, הפריט יעבור לרשימת 'ממתינים ל-PO'">✓</button>
        <select class="snooze-sel" onchange="snoozeInbox('${nk}', this.value)" title="הזכר לי מאוחר יותר">
          <option value="">⏰</option><option value="1">מחר</option><option value="3">בעוד 3 ימים</option><option value="7">בעוד שבוע</option>
        </select>
      </span>
    </div>`;
}

function agingItem(r, age, cls) {
  const note = state.notes[r.nk];
  const ageTxt = age === null ? '' : `<span class="db ${age >= 5 ? 'db-r' : age >= 2 ? 'db-o' : 'db-g'}" title="ימים מאז שהפריט הופיע לראשונה ועדיין אין לו כיסוי PO מלא">${age}י׳ ללא PO</span>`;
  const shortTxt = isShortCovered(r) ? `<span class="db db-r" title="מכוסה חלקית בהזמנות רכש">${r.allocQty ? 'חסר ' + r.short : 'אין PO'}</span>` : '';
  return `<div class="today-item aging-item ${cls}">
      <div class="ti-mpn" title="${esc(r.desc || r.mpn)}">${esc(r.mpn)}</div>
      <span>${ageTxt}${shortTxt}</span>
      ${dueBadge(r)}
      ${lineMeta(r)}
      <span class="ti-note" title="${esc(note || '')}">${note ? '📝 ' + esc(note.split('\n').pop().slice(0, 40)) : ''}</span>
    </div>`;
}

// ── Supplier follow-ups due today, one card per customer SO ─────
// Each card lists the SO's lines whose allocated PO lines are due for a supplier follow-up.
// Due PO lines not allocated to any customer SO (stock orders) go in a last card.
let _fuGroups = [];
const NO_SO = '— ללא הזמנת לקוח';

export function renderFollowups() {
  const el = document.getElementById('fu-list');
  if (!el) return;
  const btn = document.getElementById('fu-digest');
  btn.textContent = state.followups.digest ? '🔔 סיכום בוקר פעיל' : '🔕 הפעל סיכום בוקר';
  btn.classList.toggle('on', !!state.followups.digest);
  if (!state.poLoaded) { el.innerHTML = '<div class="empty" style="padding:18px">טען קובץ PO כדי לראות מעקבים</div>'; document.getElementById('fu-count').textContent = ''; return; }
  pruneFollowups();

  const due = new Set(state.poRows.filter(p => isDue(p)));
  const bySO = {}, used = new Set();
  state.allRows.filter(r => !['supplied', 'cancelled', 'cancelled_bts'].includes(r.status)).forEach(r => (r.alloc || []).forEach(a => {
    if (!due.has(a.po)) return;
    const g = bySO[r.so] = bySO[r.so] || { so: r.so, customer: r.customer, dd: null, lines: [] };
    if (r.dd && (!g.dd || r.dd < g.dd)) g.dd = r.dd;
    g.lines.push({ r, p: a.po, qty: a.qty });
    used.add(a.po);
  }));
  const lateness = p => { const d = effDate(p); return d ? TODAY - d : Infinity; };
  const lateCount = g => g.lines.filter(x => lateness(x.p) > 0).length;
  _fuGroups = Object.values(bySO)
    .map(g => ({ ...g, lines: g.lines.sort((a, b) => lateness(b.p) - lateness(a.p)) }))
    .sort((a, b) => lateCount(b) - lateCount(a) || (a.dd || Infinity) - (b.dd || Infinity));
  const stock = [...due].filter(p => !used.has(p)).sort((a, b) => lateness(b) - lateness(a));
  if (stock.length) _fuGroups.push({ so: null, customer: '', dd: null, lines: stock.map(p => ({ r: null, p, qty: p.qtyR })) });

  const poCount = due.size;
  const soCount = _fuGroups.filter(g => g.so).length;
  document.getElementById('fu-count').textContent = poCount ? `(${soCount} הזמנות · ${poCount} שורות PO)` : '';
  if (!poCount) { el.innerHTML = '<div class="empty" style="padding:18px">✓ אין מעקבים להיום</div>'; return; }

  el.innerHTML = _fuGroups.map((g, gi) => {
    const late = lateCount(g);
    const supps = new Set(g.lines.map(x => x.p.supplier || '—')).size;
    const head = g.so
      ? `<span class="fu-supp badge-link" onclick="event.preventDefault();event.stopPropagation();openSOInEmp('${esc(g.so)}')" title="פתח הזמנה">${esc(g.so)}</span>
        <span class="ti-cust" title="${esc(g.customer)}">${esc(shortCust(g.customer))}</span>
        ${g.dd ? `<span class="ti-so" title="תאריך אספקה ללקוח (המוקדם בהזמנה)">${fd(g.dd)}</span>` : ''}`
      : `<span class="fu-supp" title="שורות PO שלא משויכות להזמנת לקוח פתוחה">${NO_SO}</span>`;
    return `<details class="fu-card"${gi < 3 && g.so ? ' open' : ''}>
      <summary class="fu-hdr">
        ${head}
        <span class="badge b-x" title="שורות לטיפול היום">${g.lines.length}</span>
        ${late ? `<span class="badge b-r" title="שורות PO שתאריך האספקה שלהן עבר">🔴 ${late} באיחור</span>` : ''}
        <span class="fu-acts" onclick="event.preventDefault();event.stopPropagation()">
          <button class="btn btn-ghost" onclick="fuCopy(${gi})" title="העתק מייל מוכן לספק${supps > 1 ? ' — מייל נפרד לכל אחד מ-' + supps + ' הספקים' : ''}">📋 העתק מייל</button>
          <button class="btn btn-ghost fu-ok" onclick="fuContacted(${gi})" title="נוצר קשר עם הספקים על כל השורות — המעקב הבא נקבע אוטומטית">✓ נוצר קשר</button>
          <button class="btn btn-ghost" onclick="openImportModal()" title="הדבק את תשובת הספק לעדכון תאריכים">📥 הדבק תשובה</button>
        </span>
      </summary>
      ${g.lines.map(fuLine).join('')}
    </details>`;
  }).join('');
}

function fuLine({ r, p, qty }) {
  const k = esc(pk(p)).replace(/'/g, "\\'");
  const dd = effDate(p), late = dd && dd < TODAY;
  const last = lastContact(p);
  const promised = dd && p.dd && dd.getTime() !== p.dd.getTime();
  const iso = dd ? `${dd.getFullYear()}-${p2(dd.getMonth() + 1)}-${p2(dd.getDate())}` : '';
  const mpn = r ? r.mpn : p.mpn;
  return `<div class="today-item fu-item ${late ? 'ti-red' : 'ti-grey'}">
      <div class="ti-mpn" title="${esc((r && r.desc) || p.desc || mpn)}">${esc(mpn)}</div>
      <span class="ti-so" title="${r ? 'כמות בהזמנת הלקוח שמכוסה בשורת PO זו' : 'יתרה לאספקה'}">×${qty}</span>
      <span class="ti-so" title="הזמנת רכש">${esc(poLabel(p.poNum))}</span>
      <span class="ti-cust" title="${esc(p.supplier || '')}">${esc(shortCust(p.supplier) || '—')}</span>
      <span class="fu-reason">${esc(reason(p))}</span>
      <span class="ti-so" title="קשר אחרון עם הספק על שורה זו">${last ? '📞 ' + fd(new Date(last)) : ''}</span>
      <span class="inbox-acts">
        <input type="date" class="fu-date${promised ? ' has-ovr' : ''}" value="${iso}" onchange="fuPromise('${k}', this.value)"
          title="${promised ? 'תאריך שהספק מסר (בדוח PO: ' + fd(p.dd) + '). ' : ''}תאריך אספקה חדש מהספק — המעקב הבא יקבע לפיו">
        <button class="btn btn-ghost" onclick="fuLineContacted('${k}')" title="נוצר קשר על שורה זו">✓</button>
        <select class="snooze-sel" onchange="fuSnooze('${k}', this.value)" title="דחה מעקב">
          <option value="">⏰</option><option value="1">מחר</option><option value="3">בעוד 3 ימים</option><option value="7">בעוד שבוע</option>
        </select>
      </span>
    </div>`;
}

// One email per supplier involved in the card
export async function fuCopy(gi) {
  const g = _fuGroups[gi]; if (!g) return;
  const bySupp = {};
  g.lines.forEach(({ p }) => { const s = p.supplier || ''; (bySupp[s] = bySupp[s] || new Set()).add(p); });
  const parts = Object.entries(bySupp).map(([s, ps]) => emailText(s, [...ps]));
  const text = parts.length > 1 ? Object.keys(bySupp).map((s, i) => `── ${s || 'ללא ספק'} ──\n${parts[i]}`).join('\n\n') : parts[0];
  try { await navigator.clipboard.writeText(text); toast(parts.length > 1 ? `📋 ${parts.length} מיילים הועתקו (אחד לכל ספק)` : '📋 המייל הועתק — הדבק בתוכנת הדואר'); }
  catch (e) { toast('ההעתקה נכשלה'); }
}
export function fuContacted(gi) {
  const g = _fuGroups[gi]; if (!g) return;
  markContacted([...new Set(g.lines.map(x => pk(x.p)))]);
  toast('✓ ' + (g.so || NO_SO) + ' — המעקב הבא נקבע');
  renderToday();
}
export function fuLineContacted(k) { markContacted([k]); renderToday(); }
export function fuSnooze(k, days) { if (!days) return; snoozeFollowup(k, +days); renderToday(); }
export function fuPromise(k, value) {
  const p = state.poRows.find(x => pk(x) === k); if (!p) return;
  setPromised(p, value);
  toast(value ? '✓ תאריך חדש נשמר — המעקב הבא יקבע לפיו' : 'התאריך מהספק הוסר');
  renderToday();
}
export async function fuDigest() {
  const on = !state.followups.digest;
  if (on) {
    const { enablePush } = await import('../notify.js');
    if (!(await enablePush())) return;
  }
  setDigest(on);
  toast(on ? '🔔 סיכום בוקר יישלח בימים א׳–ה׳ ב-08:00' : 'סיכום הבוקר כובה');
  renderToday();
}

export function ackInbox(nk) { ackLine(nk); renderToday(); }
export function snoozeInbox(nk, days) { if (!days) return; snoozeLine(nk, +days); renderToday(); toast('⏰ יוזכר שוב בעוד ' + (days === '1' ? 'יום' : days + ' ימים')); }

export function fillSelects() {
  fillSel('fc', [...new Set(state.allRows.map(r => r.customer).filter(Boolean))].sort());
  fillSel('fs', [...new Set(state.allRows.map(r => r.supplier).filter(Boolean))].sort());
}

export function fillSel(id, items) {
  const sel = document.getElementById(id);
  sel.innerHTML = '<option value="">הכל</option>';
  items.forEach(v => { const o = document.createElement('option'); o.value = o.textContent = v; sel.appendChild(o); });
}

export function applyFilters() {
  const fc = document.getElementById('fc').value;
  const fs = document.getElementById('fs').value;
  const fu = document.getElementById('fu').checked;
  const fo = document.getElementById('fo').checked;
  const fpull = document.getElementById('fpull') ? document.getElementById('fpull').value : '';
  const fq = (document.getElementById('fq')?.value || '').trim().toUpperCase();
  state.filteredGroups = state.soGroups.map(g => {
    let l = g.lines.filter(x => x.status !== 'cancelled' && x.status !== 'cancelled_bts');
    if (!l.length) return null;
    if (fc) l = l.filter(x => x.customer === fc);
    if (fs) l = l.filter(x => x.supplier === fs);
    if (fu) l = l.filter(x => x.cov !== 'green' || isShortCovered(x));
    if (fo) l = l.filter(x => x.isOvr);
    if (fq) {
      const soMatch = g.so.toUpperCase().includes(fq) || (g.custPO || '').toUpperCase().includes(fq);
      if (!soMatch) l = l.filter(x => x.mpn.toUpperCase().includes(fq));
      if (!l.length) return null;
    }
    if (!l.length) return null;
    const grp = calcG({ ...g, lines: l });
    if (fpull === 'pull' && !grp.isPull) return null;
    if (fpull === 'nopull' && grp.isPull) return null;
    return grp;
  }).filter(Boolean).sort((a, b) => {
    const o = { red: 0, orange: 1, green: 2, grey: 3 };
    if (o[a.tl] !== o[b.tl]) return o[a.tl] - o[b.tl];
    if (!a.mn) return 1; if (!b.mn) return -1;
    return a.mn - b.mn;
  });
  state.soReg = {};
  state.filteredGroups.forEach(g => { state.soReg[g.so] = g; });
  renderSOList();
}

export function renderSOList() {
  const el = document.getElementById('so-content');
  if (!state.filteredGroups.length) { el.innerHTML = '<div class="empty">אין הזמנות להצגה</div>'; return; }
  el.innerHTML = state.filteredGroups.map(renderSOCard).join('');
}

export function renderSOCard(g) {
  const id = 'so_' + g.so.replace(/\W/g, '_');
  const tc = 'tl-' + (g.tl === 'red' ? 'r' : g.tl === 'orange' ? 'o' : g.tl === 'green' ? 'g' : 'x');
  const cc = 'c' + (g.tl === 'red' ? 'r' : g.tl === 'orange' ? 'o' : 'g');
  const same = g.mn && g.mx && g.mn.getTime() === g.mx.getTime();
  const ds = g.mn ? (same ? fd(g.mn) : fd(g.mn) + '–' + fd(g.mx)) : '—';
  const dc = g.mn && g.mn < TODAY ? 'past' : (g.mn && g.mn - TODAY < 30 * 86400000 ? 'curr' : '');
  const bs = [];
  if (g.ovr) bs.push(`<span class="badge b-r" title="שורות שתאריך האספקה ללקוח עבר וטרם סופקו">🔴 ${g.ovr}</span>`);
  if (g.unc) bs.push(`<span class="badge b-o" title="שורות ללא כיסוי הזמנת רכש (טרם הוזמנו מספק)">⚠ ${g.unc}</span>`);
  if (g.cov) bs.push(`<span class="badge b-g" title="שורות מכוסות במלואן בהזמנת רכש">✓ ${g.cov}</span>`);
  if (g.short) bs.push(`<span class="badge b-o" title="שורות ללא כיסוי PO מלא">חסר ${g.short}</span>`);
  bs.push(`<span class="badge b-x" title="סה״כ שורות בהזמנה">${g.lines.length}</span>`);
  const ss = g.supps.length ? `<div class="suppstrip">${g.supps.slice(0, 4).map(sv => `<span class="badge b-a">${esc(sv)}</span>`).join('')}</div>` : '';
  const snk = 'SO__' + g.so;
  const sn = esc(state.notes[snk] || '');
  return `<div class="socard ${cc}" id="card_${id}">
    <div class="sohdr" onclick="hdrClk(event,'${id}')">
      <div class="soid">
        <span class="stl ${tc}"></span>
        <div><div class="${g.lines.some(r => r.isTemp) ? 'sonum-temp' : g.lines.some(r => r.isSOImport) ? 'sonum-soimp' : 'sonum'}">${esc(g.so)}</div><div class="socpo">${esc(g.custPO)}${g.isPull ? ' <span class="pull-badge">תיק משיכה</span>' : ''}${g.lines.some(r => r.isTemp) ? ' <span class="pull-badge" style="background:rgba(255,165,0,.15);color:var(--ora);border-color:rgba(255,165,0,.35)">טמפ\'</span>' : ''}${g.lines.some(r => r.isSOImport) ? ' <span class="pull-badge" style="background:rgba(0,140,255,.12);color:var(--acc);border-color:rgba(0,140,255,.3)">PDF</span>' : ''}</div></div>
      </div>
      <div class="socust" title="${esc(g.customer)}">${esc(g.customer)}</div>
      <div class="sodate ${dc}">${ds}</div>
      <div class="sobadges">${bs.join('')}</div>
      <div onclick="event.stopPropagation();dlSOICS(state.soReg['${esc(g.so)}'])">
        <button class="bics" title="הורד קובץ ICS">📅 ICS</button>
      </div>
      <div class="so-actions" onclick="event.stopPropagation()">
        <button class="so-action-link" onclick="setSOStatus('${esc(g.so)}','ordered')" title="סמן הכל כ'הוזמן מהספק'">📦 הוזמן</button>
        <button class="so-action-link" onclick="setSOStatus('${esc(g.so)}','supplied')" title="סמן הכל כ'סופק ללקוח'">✅ סופק</button>
        <button class="so-action-link" onclick="setSOStatus('${esc(g.so)}','cancelled')" title="סמן הכל כ'בוטל'">❌ בוטל</button>
      </div>
      <div onclick="event.stopPropagation()">
        <textarea class="sonote-ta ${sn ? 'hn' : ''}" rows="1"
          data-key="${esc(snk)}" placeholder="הערה להזמנה..."
          onchange="saveNote(this)" oninput="autoH(this)">${sn}</textarea>
      </div>
      <div class="sochev" id="chev_${id}">▼</div>
    </div>
    <div class="sodet" id="det_${id}">
      ${ss}
      <div class="dtwrap">${buildLT(g.lines)}</div>
    </div>
  </div>`;
}

export function setSOStatus(soNum, status) {
  state.allRows.filter(r => r.so === soNum && r.status !== 'cancelled' && r.status !== 'cancelled_bts').forEach(r => { state.statusOvr[r.nk] = status; });
  localStorage.setItem('oo_status', JSON.stringify(state.statusOvr));
  // re-apply overrides and rebuild
  import('../persistence.js').then(({ applyOverridesToRows, syncOverrides }) => {
    applyOverridesToRows(state.allRows);
    import('../parse/so.js').then(({ buildGroups }) => {
      state.soGroups = buildGroups(state.allRows);
      syncOverrides();
      applyFilters();
    });
  });
}

export function hdrClk(e, id) {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
  togSO(id);
}

export function togSO(id) {
  const det = document.getElementById('det_' + id);
  det.classList.toggle('open');
  document.getElementById('chev_' + id).classList.toggle('open');
  if (det.classList.contains('open')) expandNotes(det);
}

export function expandAll(v) {
  document.querySelectorAll('.sodet').forEach(d => d.classList[v ? 'add' : 'remove']('open'));
  document.querySelectorAll('.sochev').forEach(c => c.classList[v ? 'add' : 'remove']('open'));
  if (v) expandNotes();
  const b = document.getElementById('bex');
  if (v) { b.textContent = 'סגור הכל ▲'; b.onclick = () => expandAll(false); }
  else { b.textContent = 'פתח הכל ▾'; b.onclick = () => expandAll(true); }
}

export function buildLT(lines) {
  return `<table class="lt"><thead><tr>
    <th style="width:12px"></th><th>פריט (MPN)</th><th>ת. אספקה</th>
    <th>יתרה</th><th>מחיר</th><th><span class="tip tip-l"><span class="tip-icon">?</span><span class="tip-box">לחץ לעריכת שם הספק.</span></span>ספק</th><th><span class="tip tip-l"><span class="tip-icon">?</span><span class="tip-box">לחץ לעריכת מספר הזמנת הרכש.</span></span>PO רכש</th><th><span class="tip tip-l"><span class="tip-icon">?</span><span class="tip-box">מספר מעקב משלוח.</span></span>מעקב</th>
    <th style="width:170px"><span class="tip tip-l"><span class="tip-icon">?</span><span class="tip-box">עדכון ידני של סטטוס הפריט.</span></span>סטטוס</th><th style="min-width:150px"><span class="tip tip-l"><span class="tip-icon">?</span><span class="tip-box">הערה חופשית לפריט.</span></span>הערות</th>
  </tr></thead><tbody>${lines.map(buildLR).join('')}</tbody></table>`;
}

export function buildLR(r) {
  const dc = r.isOvr ? 'past' : (r.dd && r.dd - TODAY < 30 * 86400000 ? 'curr' : '');
  const db = r.daysOvr > 0 ? `<span class="db ${r.daysOvr > 30 ? 'db-r' : 'db-o'}" title="${r.daysOvr} ימים מאז תאריך האספקה ללקוח">${r.daysOvr}י׳</span>` : '';
  const suppOvr = state.fieldOvr[r.nk + '__supp'];
  const poOvr = state.fieldOvr[r.nk + '__po'];
  const suppVal = suppOvr !== undefined ? suppOvr : r.supplier;
  const poVal = poOvr !== undefined ? poOvr : r.poNum;
  const sh = `<input class="edit-inp${suppOvr !== undefined ? ' has-ovr' : ''}" type="text"
    data-field="supp" data-key="${esc(r.nk)}"
    value="${esc(suppVal)}" placeholder="ספק..."
    onchange="saveField(this)" title="לחץ לעריכת שם הספק">`;
  const ph = `<input class="edit-inp${poOvr !== undefined ? ' has-ovr' : ''}" type="text"
    data-field="po" data-key="${esc(r.nk)}"
    value="${esc(poVal)}" placeholder="PO..."
    onchange="saveField(this)" title="לחץ לעריכת מספר הזמנת רכש">`;
  const trackOvr = state.fieldOvr[r.nk + '__tracking'];
  const trackVal = trackOvr || '';
  const trackUrl = _trackingUrl(trackVal);
  const th = `<div style="display:flex;align-items:center;gap:4px">
    <input class="edit-inp${trackOvr ? ' has-ovr' : ''}" type="text"
      data-field="tracking" data-key="${esc(r.nk)}"
      value="${esc(trackVal)}" placeholder="מעקב..."
      onchange="saveField(this)" title="מספר מעקב">
    ${trackUrl ? `<a href="${trackUrl}" target="_blank" rel="noopener" title="עקוב אחר המשלוח" style="color:var(--acc);font-size:14px;text-decoration:none;flex-shrink:0;line-height:1">🔗</a>` : ''}
  </div>`;
  // PO-based status inference happens in linkPOtoSO, which only uses POs actually tied to this line
  const effStatus = state.statusOvr[r.nk] || r.status;
  const covBadges = (isShortCovered(r)
      ? (r.allocQty
        ? `<span class="db db-r" title="רק ${r.allocQty} יחידות מכוסות בהזמנות רכש פתוחות — חסרות ${r.short}">חסר ${r.short}</span>`
        : `<span class="db db-r" title="מסומן כהוזמן, אך בדוח הזמנות הרכש אין כמות פתוחה לפריט זה. בדוק שההזמנה אכן בוצעה (או שהתקבלה כבר) ועדכן סטטוס / מספר PO">אין PO</span>`) : '')
    + (r.allocLate
      ? `<span class="db db-o" title="${esc(r.alloc.filter(a => a.po.dd && a.po.dd > r.dd).map(a => 'PO ' + a.po.poNum + ' צפוי ' + fd(a.po.dd)).join(' · '))}">PO מאחר</span>` : '');
  const selCls = ({ 'none':'s-non','pending':'s-pnd','sourcing':'s-pnd','ordered':'s-ord','waiting_wh':'s-ord','in_transit':'s-ord','customs_sub':'s-pnd','customs_rel':'s-ord','delivery_bts':'s-ord','qc_supp':'s-qc','qc':'s-qc','supplied':'s-grn','partial':'s-pnd','waiting_cust':'s-pnd','cancelled':'s-can','cancelled_bts':'s-can' })[effStatus] || 's-non';
  const STATUSES = [
    ['none','— ללא סטטוס','s-non'],['pending','טרם הוזמן','s-pnd'],['sourcing','איתור ספק','s-pnd'],
    ['ordered','הוזמן מהספק','s-ord'],['waiting_wh','ממתין במחסן המוצא','s-ord'],['in_transit','נחת בארץ','s-ord'],
    ['customs_sub','הגשות למכס','s-pnd'],['customs_rel','שוחרר ממכס','s-ord'],['delivery_bts','בשליחות ל-BTS','s-ord'],
    ['qc_supp','בקרת איכות ספק / מעבדה','s-qc'],['qc','בבקרת איכות','s-qc'],['supplied','סופק ללקוח','s-grn'],
    ['partial','סופק חלקי','s-pnd'],['waiting_cust','ממתין לאספקה ללקוח','s-pnd'],
    ['cancelled','בוטל ע"י הלקוח','s-can'],['cancelled_bts','בוטל ע"י BTS','s-can'],
  ];
  const sbh = `<select class="stat-sel ${selCls}" data-key="${esc(r.nk)}" onchange="saveStatus(this)">
    ${STATUSES.map(([v, l]) => `<option value="${v}" ${effStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
  </select>`;
  const nv = esc(state.notes[r.nk] || '');
  // Dot and row highlight answer "do I need to act?": a green line that's short on PO quantity counts as needing action
  const needsPO = r.cov !== 'green' || isShortCovered(r);
  const dot = isShortCovered(r) ? 'o' : r.cov === 'green' ? 'g' : r.cov === 'orange' ? 'o' : r.cov === 'red' ? 'r' : 'x';
  return `<tr class="${(r.isOvr && r.status !== 'supplied' && needsPO) ? 'lno' : ''}">
    <td style="text-align:center"><span class="lntl tl-${dot}"></span></td>
    <td><div class="mpn" title="${esc(r.desc || r.mpn)}">${esc(r.mpn)}</div></td>
    <td class="ddate ${dc}">${db}${fd(r.dd)}</td>
    <td class="qty">${r.qtyR || r.qtyO}${covBadges}</td>
    <td class="qty">${r.price ? (({ 'ILS': '₪', 'USD': '$', 'EUR': '€', 'GBP': '£' })[r.currency] || r.currency || '₪') + r.price.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
    <td>${sh}</td><td>${ph}</td><td>${th}</td><td>${sbh}</td>
    <td><textarea class="note-ta ${nv ? 'hn' : ''}" rows="1" data-key="${esc(r.nk)}"
      placeholder="הוסף הערה..." onchange="saveNote(this)" oninput="autoH(this)">${nv}</textarea></td>
  </tr>`;
}

export function _trackingUrl(t) {
  if (!t) return '';
  t = t.trim();
  if (/^(96|97)\d{18}$/.test(t) || /^[0-9]{12}$/.test(t) || /^[0-9]{15}$/.test(t) || /^[0-9]{20}$/.test(t))
    return 'https://www.fedex.com/fedextrack/?trknbr=' + t;
  if (/^1Z[A-Z0-9]{16}$/i.test(t))
    return 'https://www.ups.com/track?tracknum=' + t;
  if (/^[0-9]{10}$/.test(t) || /^(JD|GM)[0-9]{18}$/i.test(t))
    return 'https://www.dhl.com/en/express/tracking.html?AWB=' + t + '&brand=DHL';
  if (/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/i.test(t))
    return 'https://ipost.post.co.il/track?barcode=' + t;
  if (t.length >= 10)
    return 'https://t.17track.net/en#nums=' + t;
  return '';
}
