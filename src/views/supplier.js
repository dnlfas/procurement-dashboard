import { state, TODAY } from '../state.js';
import { esc, fd } from '../utils.js';
import { renderCoverage } from './boss.js';
import { renderSSP } from './ssp.js';

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
  if (q) groups = groups.filter(g => g.supplier.toLowerCase().includes(q));
  if (ovrOnly) groups = groups.filter(g => g.rows.some(r => r.isOvr));

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

    const badges = [];
    if (ovrRows.length) badges.push(`<span class="badge b-r">🔴 ${ovrRows.length} באיחור</span>`);
    if (partialRows.length) badges.push(`<span class="badge b-o">◑ ${partialRows.length} חלקי</span>`);
    if (crossSO && matched.length) badges.push(`<span class="badge b-a">🔗 ${matched.length} מחובר SO</span>`);

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
          <div class="sochev" id="chev_${sid}">▼</div>
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
      <div class="sodet" id="det_${sid}">
        <div class="dtwrap">${buildPOTable(g.rows, soMPNs, crossSO)}</div>
      </div>
    </div>`;
  }).join('');
}

export function buildPOTable(rows, soMPNs, crossSO) {
  const sorted = [...rows].sort((a, b) => {
    if (a.isOvr && !b.isOvr) return -1; if (!a.isOvr && b.isOvr) return 1;
    if (!a.dd) return 1; if (!b.dd) return -1; return a.dd - b.dd;
  });
  return `<table class="lt"><thead><tr>
    <th style="width:12px"></th>
    <th>פריט (MPN)</th>
    <th>תיאור</th>
    <th>PO</th>
    <th>ת. אספקה</th>
    <th>הוזמן</th>
    <th>סופק</th>
    <th>יתרה</th>
    <th>ערך ₪</th>
    ${crossSO ? '<th>SO</th>' : ''}
  </tr></thead><tbody>
  ${sorted.map(r => {
    const dc = r.isOvr ? 'past' : (r.dd && r.dd - TODAY < 30 * 86400000 ? 'curr' : '');
    const dayB = r.isOvr ? `<span class="db db-r">${Math.floor((TODAY - r.dd) / 86400000)}י׳</span>` : '';
    const tl = r.isOvr ? 'r' : r.isPartial ? 'o' : 'g';
    const soMatch = crossSO && soMPNs.has(r.mpn.trim().toUpperCase());
    return `<tr class="${r.isOvr ? 'lno' : ''}">
      <td style="text-align:center"><span class="lntl tl-${tl}"></span></td>
      <td><div class="mpn" title="${esc(r.mpn)}">${esc(r.mpn)}</div></td>
      <td style="font-size:11px;color:var(--txt2);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.desc)}">${esc(r.desc)}</td>
      <td class="ptxt">${esc(r.poNum)}</td>
      <td class="ddate ${dc}">${dayB}${fd(r.dd)}</td>
      <td class="qty">${r.qtyO}</td>
      <td class="qty" style="${r.qtyS > 0 ? 'color:var(--grn)' : ''}">${r.qtyS}</td>
      <td class="qty" style="${r.isOvr ? 'color:var(--red)' : ''}">${r.qtyR}</td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--txt2);white-space:nowrap">₪${Math.round(r.valILS).toLocaleString()}</td>
      ${crossSO ? `<td>${soMatch ? '<span class="badge b-a" style="font-size:10px">✓</span>' : '<span style="color:var(--txt2);font-size:11px">—</span>'}</td>` : ''}
    </tr>`;
  }).join('')}
  </tbody></table>`;
}
