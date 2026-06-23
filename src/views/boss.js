import { state, TODAY } from '../state.js';
import { esc, fd, p2 } from '../utils.js';
import { renderSSP } from './ssp.js';

export function renderBoss() {
  const all = state.allRows.filter(r => r.status !== 'cancelled' && r.status !== 'cancelled_bts');
  const poMPNs = new Set(state.poRows.map(r => r.mpn.trim().toUpperCase()));
  const covFn = l => l.cov === 'green' || (state.poLoaded && poMPNs.has(l.mpn.trim().toUpperCase()));
  const ovr = all.filter(l => l.isOvr && !covFn(l)).length;
  const pnd = all.filter(l => !l.isOvr && !covFn(l)).length;
  const ord = all.filter(l => covFn(l)).length;
  const pct = all.length ? Math.round(ord / all.length * 100) : 0;
  document.getElementById('bk1').textContent = ovr;
  document.getElementById('bk1s').textContent = 'שורות פריטים';
  document.getElementById('bk2').textContent = pnd;
  document.getElementById('bk2s').textContent = 'שורות פריטים';
  document.getElementById('bk3').textContent = ord;
  let trendStr = '';
  try {
    const hist = JSON.parse(localStorage.getItem('oo_cov_pct_hist') || '[]');
    const prev = hist.length ? hist[hist.length - 1].pct : null;
    if (prev !== null) { const d = pct - prev; trendStr = d > 0 ? ' ↑' + d + '%' : d < 0 ? ' ↓' + Math.abs(d) + '%' : ' →'; }
    hist.push({ ts: Date.now(), pct });
    if (hist.length > 7) hist.shift();
    localStorage.setItem('oo_cov_pct_hist', JSON.stringify(hist));
  } catch(e) {}
  document.getElementById('bk3s').textContent = pct + '% מהפריטים' + (state.poLoaded ? ' (כולל PO)' : '') + trendStr;
  document.getElementById('bk4').textContent = state.soGroups.filter(g => g.lines.some(r => r.status !== 'cancelled' && r.status !== 'cancelled_bts')).length;
  document.getElementById('bk4s').textContent = all.length + ' פריטים';
  renderChart();
  renderDueThisWeek();
  renderCustRisk();
  renderSuppList();
  renderCoverage();
  renderSSP();
}

export function renderChart() {
  const todayKey = TODAY.getFullYear() + '-' + p2(TODAY.getMonth() + 1);
  const byM = {};
  state.allRows.filter(r => r.status !== 'cancelled' && r.status !== 'cancelled_bts').forEach(r => {
    if (!r.dd) return;
    const k = r.dd.getFullYear() + '-' + p2(r.dd.getMonth() + 1);
    byM[k] = (byM[k] || 0) + 1;
  });
  const keys = Object.keys(byM).sort().slice(0, 8);
  const max = Math.max(...Object.values(byM));
  const MN = ['','ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצ׳'];
  const el = document.getElementById('chart-bars');
  el.innerHTML = keys.map(k => {
    const [y, m] = k.split('-');
    const isPast = k < todayKey, isCurr = k === todayKey;
    const col = isPast ? 'var(--red)' : isCurr ? 'var(--ora)' : 'var(--acc)';
    const h = Math.max(4, Math.round((byM[k] / max) * 44));
    const lbl = MN[+m] + (isCurr ? '◀' : '');
    const lc = isCurr ? 'var(--ora)' : 'var(--txt2)';
    return `<div class="bar-col">
      <div class="bar-fill" style="height:${h}px;background:${col};opacity:${isCurr ? 1 : isPast ? .75 : .6}" title="${byM[k]} פריטים — ${MN[+m]} ${y}"></div>
      <div class="bar-lbl" style="color:${lc}">${lbl}</div>
    </div>`;
  }).join('');
}

export function renderDueThisWeek() {
  const WEEK = 7 * 86400000;
  const items = state.allRows.filter(r => {
    if (!r.dd || r.isOvr) return false;
    if (r.cov === 'green') return false;
    if (r.status === 'cancelled' || r.status === 'cancelled_bts' || r.status === 'supplied') return false;
    const diff = r.dd - TODAY;
    return diff >= 0 && diff <= WEEK;
  }).sort((a, b) => a.dd - b.dd);
  const el = document.getElementById('due-week-list');
  const cnt = document.getElementById('due-week-count');
  if (!items.length) {
    const ovrCount = state.allRows.filter(r => r.isOvr && r.cov !== 'green').length;
    const ovrNote = ovrCount ? ` · ${ovrCount} פריטים כבר באיחור` : '';
    el.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--txt2);text-align:center;font-family:var(--mono)">✓ אין פריטים חדשים השבוע${ovrNote}</div>`;
    cnt.textContent = '';
    return;
  }
  cnt.textContent = items.length;
  const show = items.slice(0, 8);
  el.innerHTML = show.map(r => {
    const days = Math.floor((r.dd - TODAY) / 86400000);
    const cls = days <= 2 ? 'rb-red' : days <= 4 ? 'rb-ora' : 'rb-grn';
    return `<div class="risk-row">
      <span class="risk-badge ${cls}" style="min-width:28px;text-align:center">${days}י׳</span>
      <div class="risk-name" style="font-size:13px;font-family:var(--mono)">${esc(r.mpn)}</div>
      <div style="font-size:12px;color:var(--txt2);flex-shrink:0;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.customer || '')}</div>
    </div>`;
  }).join('') + (items.length > 8 ? `<div style="font-size:11px;color:var(--txt2);text-align:center;padding:4px 0;font-family:var(--mono)">+${items.length - 8} נוספים</div>` : '');
}

export function renderCustRisk() {
  const byC = {};
  state.allRows.filter(r => r.status !== 'supplied' && r.status !== 'cancelled' && r.status !== 'cancelled_bts').forEach(r => {
    const k = r.customer || 'לא ידוע';
    if (!byC[k]) byC[k] = { total: 0, ovr: 0, unc: 0, cov: 0, earliest: null };
    byC[k].total++;
    if (r.isOvr && r.cov !== 'green') {
      byC[k].ovr++;
      if (!byC[k].earliest || r.dd < byC[k].earliest) byC[k].earliest = r.dd;
    }
    if (!r.isOvr && r.cov !== 'green') byC[k].unc++;
    if (r.cov === 'green') byC[k].cov++;
  });
  const sorted = Object.entries(byC).sort((a, b) => {
    if (b[1].ovr !== a[1].ovr) return b[1].ovr - a[1].ovr;
    return b[1].total - a[1].total;
  });
  const el = document.getElementById('cust-risk');
  document.getElementById('cust-count').textContent = '(' + sorted.length + ')';
  const shortName = n => n.replace(/\(.*?\)/g, '').replace(/בע"מ/g, '').trim().slice(0, 24);
  let alertHTML = '';
  if (sorted.length && sorted[0][1].ovr >= 50) {
    const [topK, topV] = sorted[0];
    alertHTML = `<div class="risk-alert">⚠ ${esc(shortName(topK))} — ${topV.ovr} פריטים באיחור — ריכוז גבוה</div>`;
  }
  let seenNonOvr = false;
  el.innerHTML = alertHTML + sorted.map(([k, v]) => {
    const badges = [];
    if (v.ovr > 0) badges.push(`<span class="risk-badge rb-red">🔴 ${v.ovr} באיחור</span>`);
    if (v.unc > 0) badges.push(`<span class="risk-badge rb-ora">⚠ ${v.unc} ממתין</span>`);
    if (v.cov > 0) badges.push(`<span class="risk-badge rb-grn">✓ ${v.cov}</span>`);
    let divider = '';
    if (!seenNonOvr && v.ovr === 0) { seenNonOvr = true; divider = '<div class="risk-divider">ממתין בלבד</div>'; }
    return divider + `<div class="risk-row" style="flex-wrap:wrap;gap:6px">
      <div class="risk-name" style="min-width:120px">${esc(shortName(k))}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${badges.join('')}</div>
    </div>`;
  }).join('');
}

export function renderSuppList() {
  const byS = {};
  state.allRows.filter(r => r.supplier && r.status !== 'cancelled' && r.status !== 'cancelled_bts').forEach(r => {
    if (!byS[r.supplier]) byS[r.supplier] = { total: 0, ovr: 0, qc: 0 };
    byS[r.supplier].total++;
    if (r.isOvr && r.cov !== 'green') byS[r.supplier].ovr++;
    if (r.status === 'qc') byS[r.supplier].qc++;
  });
  const sorted = Object.entries(byS).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  const el = document.getElementById('supp-list');
  el.innerHTML = sorted.map(([k, v]) => {
    const badgeCls = v.ovr > 0 ? 'rb-red' : v.qc > 0 ? 'rb-pur' : 'rb-grn';
    const badgeTxt = v.ovr > 0 ? v.ovr + ' באיחור' : v.qc > 0 ? v.qc + ' QC' : v.total + ' פריטים';
    return `<div class="risk-row">
      <div class="risk-name">${esc(k)}</div>
      <span class="risk-badge ${badgeCls}">${badgeTxt}</span>
    </div>`;
  }).join('');
}

export function renderCoverage() {
  const byC = {};
  const poMPNs = new Set(state.poRows.map(r => r.mpn.trim().toUpperCase()));
  state.allRows.filter(r => r.status !== 'cancelled' && r.status !== 'cancelled_bts').forEach(r => {
    const k = (r.customer || 'לא ידוע').replace(/\(.*?\)/g, '').replace(/בע"מ/g, '').trim().slice(0, 20);
    if (!byC[k]) byC[k] = { tot: 0, cov: 0, poCov: 0 };
    byC[k].tot++;
    if (r.cov === 'green') byC[k].cov++;
    if (state.poLoaded && poMPNs.has(r.mpn.trim().toUpperCase())) byC[k].poCov++;
  });
  const el = document.getElementById('cov-list');
  el.innerHTML = Object.entries(byC).sort((a, b) => b[1].tot - a[1].tot).slice(0, 5).map(function([k, v]) {
    const soPct = Math.round(v.cov / v.tot * 100);
    const poPct = state.poLoaded ? Math.round(v.poCov / v.tot * 100) : null;
    const pct = poPct !== null ? Math.max(soPct, poPct) : soPct;
    const col = pct > 60 ? 'var(--grn)' : pct > 30 ? 'var(--ora)' : 'var(--red)';
    const subLabel = poPct !== null ? 'SO: ' + soPct + '% · PO: ' + poPct + '%' : soPct + '%';
    return '<div class="cov-row">'
      + '<div class="cov-meta"><span class="cov-name">' + esc(k) + '</span><span class="cov-pct" style="font-size:10px">' + subLabel + '</span></div>'
      + '<div class="cov-track"><div class="cov-fill" style="width:' + pct + '%;background:' + col + '"></div></div>'
      + '</div>';
  }).join('');
}
