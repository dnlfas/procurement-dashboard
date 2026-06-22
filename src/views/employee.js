import { state, TODAY, NK } from '../state.js';
import { esc, fd, p2, autoH, expandNotes } from '../utils.js';
import { calcG } from '../parse/so.js';
import { saveField, saveStatus, saveNote } from '../persistence.js';
import { bestPOMatch } from '../parse/po.js';

export function renderToday() {
  const urgent = state.allRows
    .filter(r => r.isOvr && r.cov !== 'green' && r.status !== 'cancelled')
    .sort((a, b) => b.daysOvr - a.daysOvr);
  document.getElementById('today-count').textContent = '(' + urgent.length + ')';
  const el = document.getElementById('today-list');
  el.innerHTML = urgent.slice(0, 20).map(r => {
    const cls = r.daysOvr > 30 ? 'ti-red' : 'ti-ora';
    const dc = r.daysOvr > 30 ? 'td-red' : 'td-ora';
    const bc = r.daysOvr > 30 ? 'db-r' : 'db-o';
    return `<div class="today-item ${cls}">
      <div class="ti-dot ${dc}"></div>
      <div class="ti-mpn" title="${esc(r.mpn)}">${esc(r.mpn)}</div>
      <span class="ti-cust" title="${esc(r.customer)}">${esc((r.customer || '').replace(/\(.*?\)/g, '').replace(/בע"מ/g, '').trim().slice(0, 18))}</span>
      <span class="db ${bc}">${r.daysOvr}י׳</span>
      <span class="ti-so">${esc(r.so)}</span>
    </div>`;
  }).join('') + (urgent.length > 20 ? `<div class="more-hint">+ ${urgent.length - 20} פריטים נוספים</div>` : '');
  const stat = `${urgent.length} פריטים דחופים · ${state.soGroups.length} הזמנות · ${state.allRows.length} פריטים סה"כ`;
  document.getElementById('emp-stat').textContent = stat;
}

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
    let l = g.lines;
    if (fc) l = l.filter(x => x.customer === fc);
    if (fs) l = l.filter(x => x.supplier === fs);
    if (fu) l = l.filter(x => x.cov !== 'green');
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
  }).filter(Boolean);
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
  if (g.ovr) bs.push(`<span class="badge b-r">🔴 ${g.ovr}</span>`);
  if (g.unc) bs.push(`<span class="badge b-o">⚠ ${g.unc}</span>`);
  if (g.cov) bs.push(`<span class="badge b-g">✓ ${g.cov}</span>`);
  bs.push(`<span class="badge b-x">${g.lines.length}</span>`);
  const ss = g.supps.length ? `<div class="suppstrip">${g.supps.slice(0, 4).map(sv => `<span class="badge b-a">${esc(sv)}</span>`).join('')}</div>` : '';
  const snk = 'SO__' + g.so;
  const sn = esc(state.notes[snk] || '');
  return `<div class="socard ${cc}" id="card_${id}">
    <div class="sohdr" onclick="hdrClk(event,'${id}')">
      <div class="soid">
        <span class="stl ${tc}"></span>
        <div><div class="${g.lines.some(r => r.isTemp) ? 'sonum-temp' : g.lines.some(r => r.isSOImport) ? 'sonum-soimp' : 'sonum'}">${esc(g.so)}</div><div class="socpo">${esc(g.custPO)}${g.isPull ? ' <span class="pull-badge">תיק משיכה</span>' : ''}${g.lines.some(r => r.isTemp) ? ' <span class="pull-badge" style="background:rgba(255,165,0,.15);color:var(--ora);border-color:rgba(255,165,0,.35)">טמפ\'</span>' : ''}${g.lines.some(r => r.isSOImport) ? ' <span class="pull-badge" style="background:rgba(0,140,255,.12);color:var(--acc);border-color:rgba(0,140,255,.3)">PDF</span>' : ''}</div>${g.customer ? `<div class="socust-sub">${esc(g.customer)}</div>` : ''}</div>
      </div>
      <div class="socust">${esc(g.customer)}</div>
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
  const db = r.daysOvr > 0 ? `<span class="db ${r.daysOvr > 30 ? 'db-r' : 'db-o'}">${r.daysOvr}י׳</span>` : '';
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
  let poAutoStatus = null;
  if (state.poLoaded) {
    const mpnUp = r.mpn.trim().toUpperCase();
    const poMatch = bestPOMatch(r, state.poRows.filter(p => p.mpn.trim().toUpperCase() === mpnUp));
    if (poMatch) {
      if (poMatch.qtyS > 0 && poMatch.qtyR > 0) poAutoStatus = 'partial';
      else if (poMatch.qtyS > 0 && poMatch.qtyR === 0) poAutoStatus = 'supplied';
      else if (poMatch.qtyR > 0 && r.status === 'none') poAutoStatus = 'ordered';
    }
  }
  const effStatus = state.statusOvr[r.nk] || (poAutoStatus) || r.status;
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
  return `<tr class="${(r.isOvr && r.cov !== 'green') ? 'lno' : ''}">
    <td style="text-align:center"><span class="lntl tl-${r.cov === 'green' ? 'g' : r.cov === 'orange' ? 'o' : r.cov === 'red' ? 'r' : 'x'}"></span></td>
    <td><div class="mpn" title="${esc(r.desc || r.mpn)}">${esc(r.mpn)}</div></td>
    <td class="ddate ${dc}">${db}${fd(r.dd)}</td>
    <td class="qty">${r.qtyR || r.qtyO}</td>
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
