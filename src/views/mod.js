import { state, TODAY } from '../state.js';
import { esc, fd, p2 } from '../utils.js';

const MOD_KEY = 'משרד הביטחון';
const isMOD = r => (r.customer || '').includes(MOD_KEY);
const notCanc = r => r.status !== 'cancelled' && r.status !== 'cancelled_bts';

export function renderMOD() {
  if (!state.allRows.length) {
    document.getElementById('mod-so-list').innerHTML =
      '<div style="padding:24px;text-align:center;color:var(--txt2);font-size:13px">טען קובץ הזמנות פתוחות כדי לראות נתוני מה"ב</div>';
    return;
  }

  const modRows = state.allRows.filter(r => isMOD(r) && notCanc(r));

  if (!modRows.length) {
    ['mk1','mk2','mk3','mk4'].forEach(id => { document.getElementById(id).textContent = '0'; });
    document.getElementById('mk1s').textContent = 'שורות פריטים';
    document.getElementById('mk2s').textContent = 'שורות פריטים';
    document.getElementById('mk3s').textContent = '0% מכוסה · 0 פריטים';
    document.getElementById('mk4s').textContent = '0 פריטים';
    document.getElementById('mod-so-list').innerHTML =
      '<div style="padding:24px;text-align:center;color:var(--txt2);font-size:13px">אין הזמנות פתוחות למשרד הביטחון</div>';
    document.getElementById('mod-due-list').innerHTML = '';
    document.getElementById('mod-due-count').textContent = '';
    document.getElementById('mod-chart-bars').innerHTML = '';
    document.getElementById('mod-upcoming').innerHTML = '';
    document.getElementById('mod-upcoming-count').textContent = '';
    return;
  }

  const poMPNs = new Set(state.poRows.map(p => p.mpn.trim().toUpperCase()));
  const covFn = r => r.cov === 'green' || (state.poLoaded && poMPNs.has(r.mpn.trim().toUpperCase()));

  const ovr = modRows.filter(r => r.isOvr && !covFn(r)).length;
  const pnd = modRows.filter(r => !r.isOvr && !covFn(r)).length;
  const ord = modRows.filter(r => covFn(r)).length;
  const pct = Math.round(ord / modRows.length * 100);

  const modGroups = state.soGroups
    .map(g => {
      const lines = g.lines.filter(r => isMOD(r) && notCanc(r));
      if (!lines.length) return null;
      return { ...g, lines };
    })
    .filter(Boolean);

  document.getElementById('mk1').textContent = ovr;
  document.getElementById('mk1s').textContent = 'שורות פריטים';
  document.getElementById('mk2').textContent = pnd;
  document.getElementById('mk2s').textContent = 'שורות פריטים';
  document.getElementById('mk3').textContent = ord;
  document.getElementById('mk3s').textContent = pct + '% מכוסה · ' + modRows.length + ' פריטים';
  document.getElementById('mk4').textContent = modGroups.length;
  document.getElementById('mk4s').textContent = modRows.length + ' פריטים';

  _renderMODChart(modRows);
  _renderMODDue(modRows);
  _renderMODUpcoming(modRows);
  _renderMODSOList(modGroups);
}

function _renderMODChart(modRows) {
  const todayKey = TODAY.getFullYear() + '-' + p2(TODAY.getMonth() + 1);
  const byM = {};
  modRows.forEach(r => {
    if (!r.dd) return;
    const k = r.dd.getFullYear() + '-' + p2(r.dd.getMonth() + 1);
    byM[k] = (byM[k] || 0) + 1;
  });
  const keys = Object.keys(byM).sort().slice(0, 8);
  const max = Math.max(...Object.values(byM), 1);
  const MN = ['','ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצ׳'];
  document.getElementById('mod-chart-bars').innerHTML = keys.map(k => {
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

function _renderMODDue(modRows) {
  const WEEK = 7 * 86400000;
  const items = modRows.filter(r => {
    if (!r.dd || r.isOvr || r.cov === 'green') return false;
    const diff = r.dd - TODAY;
    return diff >= 0 && diff <= WEEK;
  }).sort((a, b) => a.dd - b.dd);

  const cnt = document.getElementById('mod-due-count');
  const el = document.getElementById('mod-due-list');

  if (!items.length) {
    const ovrCount = modRows.filter(r => r.isOvr && r.cov !== 'green').length;
    el.innerHTML = `<div style="padding:10px 14px;font-size:12px;color:var(--txt2);text-align:center;font-family:var(--mono)">✓ אין פריטים חדשים השבוע${ovrCount ? ' · ' + ovrCount + ' באיחור' : ''}</div>`;
    cnt.textContent = '';
    return;
  }
  cnt.textContent = items.length;
  el.innerHTML = items.slice(0, 8).map(r => {
    const days = Math.floor((r.dd - TODAY) / 86400000);
    const cls = days <= 2 ? 'rb-red' : days <= 4 ? 'rb-ora' : 'rb-grn';
    return `<div class="risk-row">
      <span class="risk-badge ${cls}" style="min-width:28px;text-align:center">${days}י׳</span>
      <div class="risk-name" style="font-size:13px;font-family:var(--mono)">${esc(r.mpn)}</div>
      <div style="font-size:12px;color:var(--txt2);flex-shrink:0">${esc(r.custPO || r.so || '')}</div>
    </div>`;
  }).join('') + (items.length > 8 ? `<div style="font-size:11px;color:var(--txt2);text-align:center;padding:4px 0;font-family:var(--mono)">+${items.length - 8} נוספים</div>` : '');
}

function _renderMODUpcoming(modRows) {
  const DAY = 86400000;
  const eligible = modRows.filter(r => r.dd && !r.isOvr && r.status !== 'supplied' && (r.dd - TODAY) / DAY <= 30 && (r.dd - TODAY) / DAY >= 0);

  // Group by SO
  const bySOMap = {};
  eligible.forEach(r => {
    if (!bySOMap[r.so]) bySOMap[r.so] = { so: r.so, custPO: r.custPO || '', lines: [] };
    bySOMap[r.so].lines.push(r);
  });

  // Sort lines within each group by dd asc; compute earliest diff for tier assignment
  const soGroups = Object.values(bySOMap).map(g => {
    g.lines.sort((a, b) => a.dd - b.dd);
    g.earliestDiff = (g.lines[0].dd - TODAY) / DAY;
    return g;
  });

  const urgentSOs = soGroups.filter(g => g.earliestDiff <= 14).sort((a, b) => a.earliestDiff - b.earliestDiff);
  const soonSOs   = soGroups.filter(g => g.earliestDiff > 14).sort((a, b) => a.earliestDiff - b.earliestDiff);

  const totalSOs = urgentSOs.length + soonSOs.length;
  document.getElementById('mod-upcoming-count').textContent = totalSOs ? totalSOs + ' הזמנות' : '';

  const itemRow = r => {
    const days = Math.floor((r.dd - TODAY) / DAY);
    const cls = days <= 14 ? 'rb-red' : 'rb-ora';
    const covDot = r.cov === 'green'
      ? '<span style="color:var(--grn);font-size:13px" title="מכוסה">●</span>'
      : '<span style="color:var(--txt2);font-size:13px" title="לא מכוסה">○</span>';
    return `<div class="risk-row" style="padding-right:28px">
      <span class="risk-badge ${cls}" style="min-width:32px;text-align:center">${days}י׳</span>
      <div class="risk-name" style="font-size:12px;font-family:var(--mono)">${esc(r.mpn)}</div>
      <div style="font-size:12px;color:var(--txt2);flex-shrink:0;font-family:var(--mono)">${fd(r.dd)}</div>
      ${covDot}
    </div>`;
  };

  const soBlock = g => {
    const minD = g.lines[0].dd, maxD = g.lines[g.lines.length - 1].dd;
    const dateRange = minD.getTime() === maxD.getTime() ? fd(minD) : fd(minD) + ' – ' + fd(maxD);
    return `<div style="margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:8px;padding:5px 14px;background:var(--sur3);border-bottom:1px solid var(--bdr)">
        <span style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--txtb)">${esc(g.so)}</span>
        ${g.custPO ? `<span style="font-size:12px;color:var(--txt2)">${esc(g.custPO)}</span>` : ''}
        <span style="font-size:11px;color:var(--txt2);margin-right:auto">${g.lines.length} פריטים · ${dateRange}</span>
      </div>
      ${g.lines.map(itemRow).join('')}
    </div>`;
  };

  const el = document.getElementById('mod-upcoming');
  if (!urgentSOs.length && !soonSOs.length) {
    el.innerHTML = '<div style="padding:10px 14px;font-size:12px;color:var(--txt2);text-align:center;font-family:var(--mono)">✓ אין אספקות קרובות ב-30 הימים הקרובים</div>';
    return;
  }

  let html = '';
  if (urgentSOs.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--red);padding:6px 14px 4px;font-family:var(--mono);letter-spacing:.03em">דחוף — עד שבועיים <span style="opacity:.7">(${urgentSOs.length} הזמנות)</span></div>`;
    html += urgentSOs.map(soBlock).join('');
  }
  if (soonSOs.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--ora);padding:${urgentSOs.length ? '10px' : '6px'} 14px 4px;font-family:var(--mono);letter-spacing:.03em">ממתין — עד חודש <span style="opacity:.7">(${soonSOs.length} הזמנות)</span></div>`;
    html += soonSOs.map(soBlock).join('');
  }
  el.innerHTML = html;
}

function _renderMODSOList(modGroups) {
  const el = document.getElementById('mod-so-list');
  if (!modGroups.length) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--txt2);font-size:13px">אין הזמנות</div>';
    return;
  }

  const STATUS_LBL = {
    none:'ללא',pending:'טרם הוזמן',sourcing:'איתור',ordered:'הוזמן',waiting_wh:'ממתין מחסן',
    in_transit:'בדרך',customs_sub:'מכס',customs_rel:'שוחרר',delivery_bts:'בשליחות',
    qc_supp:'QC ספק',qc:'QC',supplied:'סופק',partial:'חלקי',waiting_cust:'ממתין לקוח',
    cancelled:'בוטל',cancelled_bts:'בוטל BTS'
  };

  el.innerHTML = modGroups.map(g => {
    const id = 'mso_' + g.so.replace(/\W/g, '_');
    const lines = g.lines;
    const dates = lines.map(r => r.dd).filter(Boolean).sort((a, b) => a - b);
    const minD = dates[0], maxD = dates[dates.length - 1];
    const dateStr = minD ? (maxD && minD.getTime() !== maxD.getTime() ? fd(minD) + ' – ' + fd(maxD) : fd(minD)) : '—';
    const ovrCnt = lines.filter(r => r.isOvr && r.cov !== 'green').length;
    const pndCnt = lines.filter(r => !r.isOvr && r.cov !== 'green').length;
    const covCnt = lines.filter(r => r.cov === 'green').length;
    const tlCls = ovrCnt ? 'tl-r' : pndCnt ? 'tl-o' : 'tl-g';

    const badges = [
      ovrCnt ? `<span class="risk-badge rb-red">${ovrCnt} באיחור</span>` : '',
      pndCnt ? `<span class="risk-badge rb-ora">${pndCnt} ממתין</span>` : '',
      covCnt ? `<span class="risk-badge rb-grn">✓ ${covCnt}</span>` : '',
    ].filter(Boolean).join('');

    const lineRows = lines.map(r => {
      const stLbl = STATUS_LBL[state.statusOvr[r.nk] || r.status] || r.status;
      const dc = r.isOvr ? 'color:var(--red)' : r.dd && (r.dd - TODAY) < 7 * 86400000 ? 'color:var(--ora)' : '';
      return `<tr>
        <td style="font-family:var(--mono);font-size:12px">${esc(r.mpn)}</td>
        <td style="text-align:center;font-size:12px">${r.qtyR || r.qtyO}</td>
        <td style="font-size:12px;${dc}">${fd(r.dd)}</td>
        <td style="font-size:11px;color:var(--txt2)">${esc(r.supplier || '')}</td>
        <td style="font-size:11px;color:var(--txt2)">${esc(stLbl)}</td>
      </tr>`;
    }).join('');

    return `<div class="mso-card" id="card_${id}">
      <div class="mso-hdr" onclick="togMODSO('${id}')">
        <span class="lntl ${tlCls}" style="flex-shrink:0"></span>
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:var(--txtb)">${esc(g.so)}</div>
          ${g.custPO ? `<div style="font-size:11px;color:var(--txt2)">${esc(g.custPO)}</div>` : ''}
        </div>
        <div style="font-size:12px;color:var(--txt2);font-family:var(--mono);flex-shrink:0">${dateStr}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0">${badges}</div>
        <div style="font-size:11px;color:var(--txt2);flex-shrink:0;margin-right:auto">${lines.length} פריטים</div>
        <span class="mso-chev" id="chev_${id}">▼</span>
      </div>
      <div class="mso-det" id="det_${id}">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="color:var(--txt2);font-size:11px;border-bottom:1px solid var(--bdr)">
            <th style="text-align:right;padding:4px 6px;font-weight:600">MPN</th>
            <th style="text-align:center;padding:4px 6px;font-weight:600">יתרה</th>
            <th style="text-align:right;padding:4px 6px;font-weight:600">ת. אספקה</th>
            <th style="text-align:right;padding:4px 6px;font-weight:600">ספק</th>
            <th style="text-align:right;padding:4px 6px;font-weight:600">סטטוס</th>
          </tr></thead>
          <tbody>${lineRows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

export function togMODSO(id) {
  const det = document.getElementById('det_' + id);
  const chev = document.getElementById('chev_' + id);
  if (!det) return;
  const open = det.classList.toggle('open');
  if (chev) chev.textContent = open ? '▲' : '▼';
}
