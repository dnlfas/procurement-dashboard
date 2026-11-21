import { state, TODAY } from '../state.js';
import { esc, fd } from '../utils.js';
import { renderCoverage } from './boss.js';
import { renderSSP } from './ssp.js';
import { cur3, fxConvert, DEFAULT_RATES, SOPO_RULES } from '../sopo/engine.js';
import { loadLinks, linksFor, linkStatus } from '../sopolink.js';

const CUR_SYM = { USD: '$', EUR: '€', GBP: '£', ILS: '₪' };
const money = (v, cur) => { const c = cur3(cur) || cur || ''; return (CUR_SYM[c] || (c ? c + ' ' : '')) + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }); };
// Unit price: the PO's own price from the SO↔PO link report when it has this line; otherwise open value ÷ open qty
function unitPriceTxt(r, link) {
  if (link && link.buyPrice > 0) return `<span title="מחיר ליחידה מההזמנה (דוח קישור SO↔PO)">${money(link.buyPrice, link.buyCur)}</span>`;
  if (!(r.unitPrice > 0)) return '—';
  return `<span class="sopo-muted" title="מחושב: שווי היתרה ÷ יתרה לאספקה">≈${money(r.unitPrice, r.currency)}</span>`;
}
// Linked SO line(s): SO number, sell price, and the margin over the PO price (in the sell currency)
function linkCell(links) {
  if (!links.length) return '<span class="sopo-muted">—</span>';
  return links.map(l => {
    let m = '';
    const sc = cur3(l.sellCur), bc = cur3(l.buyCur);
    if (l.sellPrice > 0 && l.buyPrice > 0 && DEFAULT_RATES[sc] && DEFAULT_RATES[bc]) {
      const pct = (l.sellPrice - fxConvert(l.buyPrice, bc, sc, fxRates())) / l.sellPrice;
      const cls = pct <= 0 ? 'db-r' : pct < SOPO_RULES.minMargin ? 'db-o' : 'db-g';
      m = ` <span class="db ${cls}" title="רווח גולמי לפי מחיר מכירה מול מחיר קנייה">${Math.round(pct * 100)}%</span>`;
    }
    return `<div style="white-space:nowrap"><span class="ptxt" title="${esc(l.customer)}">${esc(l.so)}</span> · ${l.sellPrice > 0 ? money(l.sellPrice, l.sellCur) : '—'}${m}</div>`;
  }).join('');
}
// the rates SO → PO last loaded (Bank of Israel), else the defaults
function fxRates() { try { return { ...DEFAULT_RATES, ...JSON.parse(localStorage.getItem('oo_fx')).rates }; } catch (e) { return DEFAULT_RATES; } }
// The PO arrives after the date promised to the customer
const lateForCust = links => links.filter(l => l.buyDd && l.soDd && l.buyDd > l.soDd && l.buyRem > 0);

export function renderSupplierKPIs() {
  const suppCount = [...new Set(state.poRows.map(r => r.supplier).filter(Boolean))].length;
  const ovrCount = state.poRows.filter(r => r.isOvr).length;
  const totalVal = state.poRows.reduce((s, r) => s + r.valILS, 0);
  const soMPNs = new Set(state.allRows.map(r => r.mpn.trim().toUpperCase()));
  const matched = state.poRows.filter(r => soMPNs.has(r.mpn.trim().toUpperCase())).length;

  document.getElementById('sk1').textContent = suppCount;
  document.getElementById('sk1s').textContent = state.poRows.length + ' שורות';
  document.getElementById('sk2').textContent = ovrCount;
  document.getElementById('sk2s').textContent = Math.round(ovrCount / state.poRows.length * 100) + '% מהשורות';
  document.getElementById('sk3').textContent = '₪' + Math.round(totalVal / 1000) + 'K';
  document.getElementById('sk3s').textContent = '₪' + Math.round(state.poRows.filter(r => r.isOvr).reduce((s, r) => s + r.valILS, 0) / 1000) + 'K באיחור';
  document.getElementById('sk4').textContent = matched;
  document.getElementById('sk4s').textContent = 'פריטים מחוברים ל-SO';
}

export function renderSuppliers() {
  const q = (document.getElementById('supp-search').value || '').toLowerCase();
  const ovrOnly = document.getElementById('supp-ovr-only').checked;
  const crossSO = document.getElementById('supp-cross').checked;
  const soMPNs = new Set(state.allRows.map(r => r.mpn.trim().toUpperCase()));

  const byS = {};
  state.poRows.forEach(r => {
    const k = r.supplier || '— ללא ספק';
    if (!byS[k]) byS[k] = { supplier: k, rows: [], ovrVal: 0, totalVal: 0 };
    byS[k].rows.push(r);
    byS[k].totalVal += r.valILS;
    if (r.isOvr) byS[k].ovrVal += r.valILS;
  });

  let groups = Object.values(byS).sort((a, b) => b.ovrVal - a.ovrVal || b.totalVal - a.totalVal);
  if (q) {
    groups = groups.filter(g => g.supplier.toLowerCase().includes(q) || g.rows.some(r => r.mpn.toLowerCase().includes(q) || r.poNum.toLowerCase().includes(q)));
  }
  if (ovrOnly) groups = groups.filter(g => g.rows.some(r => r.isOvr));

  const ls = document.getElementById('supp-link-status');
  if (ls) ls.textContent = linkStatus();
  const el = document.getElementById('supp-cards');
  if (!groups.length) { el.innerHTML = '<div class="empty">אין ספקים להצגה</div>'; return; }

  el.innerHTML = groups.map(g => {
    const ovrRows = g.rows.filter(r => r.isOvr);
    const partialRows = g.rows.filter(r => r.isPartial);
    const matched = crossSO ? g.rows.filter(r => soMPNs.has(r.mpn.trim().toUpperCase())) : [];
    const covPct = Math.round((g.rows.length - ovrRows.length) / g.rows.length * 100);
    const tlActual = ovrRows.length === g.rows.length ? 'r' : ovrRows.length > 0 ? 'o' : 'g';
    const cc = tlActual === 'r' ? 'cr' : tlActual === 'o' ? 'co' : 'cg';
    const sid = 'sp_' + g.supplier.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    const mpnMatch = !!q && g.rows.some(r => r.mpn.toLowerCase().includes(q) || r.poNum.toLowerCase().includes(q));

    const badges = [];
    if (ovrRows.length) badges.push(`<span class="badge b-r" title="שורות PO שתאריך האספקה של הספק עבר">🔴 ${ovrRows.length} באיחור</span>`);
    if (partialRows.length) badges.push(`<span class="badge b-o" title="שורות PO שסופקו חלקית — יש יתרה לאספקה">◑ ${partialRows.length} חלקי</span>`);
    if (crossSO && matched.length) badges.push(`<span class="badge b-a" title="שורות PO שהפריט שלהן מופיע בהזמנת לקוח פתוחה">🔗 ${matched.length} מחובר SO</span>`);

    const ovrValFmt = ovrRows.length ? ` · ₪${Math.round(g.ovrVal / 1000)}K באיחור` : '';

    return `<div class="socard ${cc}" id="card_${sid}">
      <div class="ssp-hdr" onclick="togSO('${sid}')">
        <div class="ssp-hr1">
          <div class="soid">
            <span class="stl tl-${tlActual}"></span>
            <div>
              <div class="sonum" style="font-size:15px">${esc(g.supplier)}</div>
              <div class="socpo">${g.rows.length} פריטים · ₪${Math.round(g.totalVal / 1000)}K${ovrValFmt}</div>
            </div>
          </div>
          <div class="sobadges">${badges.join('')}</div>
          <div class="sochev${mpnMatch ? ' open' : ''}" id="chev_${sid}">▼</div>
        </div>
        <div class="ssp-cov">
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt2);font-family:var(--mono)">
            <span>כיסוי</span><span>${covPct}%</span>
          </div>
          <div style="height:4px;background:var(--bdr);border-radius:2px">
            <div style="width:${covPct}%;height:100%;border-radius:2px;background:${covPct > 60 ? 'var(--grn)' : covPct > 30 ? 'var(--ora)' : 'var(--red)'}"></div>
          </div>
        </div>
      </div>
      <div class="sodet${mpnMatch ? ' open' : ''}" id="det_${sid}">
        <div class="dtwrap">${buildPOTable(g.rows, soMPNs, crossSO)}</div>
      </div>
    </div>`;
  }).join('');
}

// One header row per supplier PO (number, line count, value, earliest due date, reminder bell), its lines below.
// POs with late lines first, then by earliest due date; lines inside a PO the same way.
export function buildPOTable(rows, soMPNs, crossSO) {
  const byDate = (a, b) => {
    if (a.isOvr && !b.isOvr) return -1; if (!a.isOvr && b.isOvr) return 1;
    if (!a.dd) return 1; if (!b.dd) return -1; return a.dd - b.dd;
  };
  const byPO = new Map();
  [...rows].sort(byDate).forEach(r => {
    const k = r.poNum || '—';
    if (!byPO.has(k)) byPO.set(k, []);
    byPO.get(k).push(r);
  });
  // insertion order already follows the PO's most urgent line
  const hasLinks = !!loadLinks();
  const cols = 8 + (crossSO ? 1 : 0) + (hasLinks ? 1 : 0);
  return `<table class="lt"><thead><tr>
    <th style="width:12px"></th>
    <th>פריט (MPN)</th>
    <th>תיאור</th>
    <th>ת. אספקה</th>
    <th>הוזמן</th>
    <th>סופק</th>
    <th>יתרה</th>
    <th>מחיר יח׳</th>
    ${hasLinks ? '<th title="שורות SO שמקושרות להזמנה בפריוריטי — מחיר מכירה ורווח">SO · מכירה</th>' : ''}
    ${crossSO ? '<th>SO</th>' : ''}
  </tr></thead><tbody>
  ${[...byPO].map(([po, lines]) => {
    const ovr = lines.filter(r => r.isOvr).length;
    const custLate = hasLinks ? lines.filter(r => lateForCust(linksFor(po, r.mpn)).length).length : 0;
    const val = lines.reduce((t, r) => t + (r.valILS || 0), 0);
    const first = lines.find(r => r.dd);
    const due = first ? (first.isOvr ? `<span class="db db-r">${Math.floor((TODAY - first.dd) / 86400000)}י׳</span>` : '') + fd(first.dd) : '';
    const bell = po !== '—' ? `<button class="bics" title="הגדר תזכורת" onclick="event.stopPropagation();openNotifyModal('${esc(po)}')">🔔</button>` : '';
    const head = `<tr class="po-grp${ovr ? ' po-grp-ovr' : ''}"><td colspan="${cols}">
      <span class="po-grp-num">${esc(po)}</span>${bell}
      <span class="po-grp-meta">${lines.length} שורות · ₪${Math.round(val).toLocaleString()}${due ? ' · אספקה ' + due : ''}</span>
      ${ovr ? `<span class="badge b-r">🔴 ${ovr} באיחור</span>` : ''}
      ${custLate ? `<span class="badge b-o" title="הספק יספק אחרי התאריך שהובטח ללקוח">⚠ ${custLate} אחרי מועד הלקוח</span>` : ''}
    </td></tr>`;
    return head + lines.map(r => {
      const dc = r.isOvr ? 'past' : (r.dd && r.dd - TODAY < 30 * 86400000 ? 'curr' : '');
      const dayB = r.isOvr ? `<span class="db db-r" title="ימים מאז תאריך האספקה של הספק">${Math.floor((TODAY - r.dd) / 86400000)}י׳</span>` : '';
      const tl = r.isOvr ? 'r' : r.isPartial ? 'o' : 'g';
      const soMatch = crossSO && soMPNs.has(r.mpn.trim().toUpperCase());
      const links = hasLinks ? linksFor(r.poNum, r.mpn) : [];
      const late = lateForCust(links);
      const lateB = late.length ? ` <span class="db db-o" title="הלקוח צריך עד ${late.map(l => fd(l.soDd) + ' (' + l.so + ')').join(', ')}">⚠ ${fd(late.reduce((a, l) => l.soDd < a ? l.soDd : a, late[0].soDd))}</span>` : '';
      return `<tr class="${r.isOvr ? 'lno' : ''}">
      <td style="text-align:center"><span class="lntl tl-${tl}"></span></td>
      <td><div class="mpn" title="${esc(r.mpn)}">${esc(r.mpn)}</div></td>
      <td style="font-size:11px;color:var(--txt2);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.desc)}">${esc(r.desc)}</td>
      <td class="ddate ${dc}">${dayB}${fd(r.dd)}${lateB}</td>
      <td class="qty">${r.qtyO}</td>
      <td class="qty" style="${r.qtyS > 0 ? 'color:var(--grn)' : ''}">${r.qtyS}</td>
      <td class="qty" style="${r.isOvr ? 'color:var(--red)' : ''}">${r.qtyR}</td>
      <td style="font-family:var(--mono);font-size:12px;white-space:nowrap" title="מחיר ליחידה במטבע ההזמנה">${unitPriceTxt(r, links[0])}</td>
      ${hasLinks ? `<td style="font-family:var(--mono);font-size:11px">${linkCell(links)}</td>` : ''}
      ${crossSO ? `<td>${soMatch ? '<span class="badge b-a" style="font-size:10px" title="הפריט מופיע בהזמנת לקוח פתוחה">✓</span>' : '<span style="color:var(--txt2);font-size:11px">—</span>'}</td>` : ''}
    </tr>`;
    }).join('');
  }).join('')}
  </tbody></table>`;
}
