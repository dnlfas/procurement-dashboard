import { state, TODAY } from '../state.js';
import { esc, fd, expandNotes } from '../utils.js';

export function renderSSP() {
  document.getElementById('ssp-body').classList.toggle('open', state.sspOpen);
  document.getElementById('ssp-chev').textContent = state.sspOpen ? '▲' : '▼';
  const byC = {};
  state.allRows.forEach(r => {
    const k = r.customer || 'לא ידוע';
    if (!byC[k]) byC[k] = { customer: k, sos: {} };
    if (!byC[k].sos[r.so]) byC[k].sos[r.so] = { so: r.so, custPO: r.custPO, lines: [], minDate: null, maxDate: null, ovr: 0, unc: 0, cov: 0 };
    const sg = byC[k].sos[r.so];
    sg.lines.push(r);
    if (r.dd) { if (!sg.minDate || r.dd < sg.minDate) sg.minDate = r.dd; if (!sg.maxDate || r.dd > sg.maxDate) sg.maxDate = r.dd; }
    if (r.isOvr && r.cov !== 'green') sg.ovr++;
    else if (!r.isOvr && r.cov !== 'green') sg.unc++;
    else if (r.cov === 'green') sg.cov++;
  });
  const custArr = Object.values(byC).map(function(c) {
    const sos = Object.values(c.sos);
    const totOvr = sos.reduce(function(s, g) { return s + g.ovr; }, 0);
    const totUnc = sos.reduce(function(s, g) { return s + g.unc; }, 0);
    const totCov = sos.reduce(function(s, g) { return s + g.cov; }, 0);
    const tl = totOvr > 0 ? 'r' : totUnc > 0 ? 'o' : 'g';
    return Object.assign({}, c, { sos: sos, totOvr: totOvr, totUnc: totUnc, totCov: totCov, tl: tl });
  }).sort(function(a, b) {
    const o = { r: 0, o: 1, g: 2 };
    return (o[a.tl] - o[b.tl]) || b.totOvr - a.totOvr;
  });

  document.getElementById('ssp-badge-cust').textContent = custArr.length + ' לקוחות';
  document.getElementById('ssp-badge-ovr').textContent = state.allRows.filter(function(r) { return r.isOvr && r.cov !== 'green'; }).length + ' באיחור';

  const SHOW = 5;
  const el = document.getElementById('ssp-list');
  const visible = state.sspAllOpen ? custArr : custArr.slice(0, SHOW);
  const poMPNs = new Set(state.poRows.map(function(r) { return r.mpn.trim().toUpperCase(); }));

  var html2 = '';
  visible.forEach(function(c) {
    const cid = 'cg_' + custArr.indexOf(c);
    const sname = c.customer.replace(/\(.*?\)/g, '').replace(/בע"מ/g, '').trim().slice(0, 28);
    const tlC = 'tl-' + c.tl;
    var bs = '';
    if (c.totOvr) bs += '<span class="badge b-r">🔴 ' + c.totOvr + '</span>';
    if (c.totUnc) bs += '<span class="badge b-o">⚠ ' + c.totUnc + '</span>';
    if (c.totCov) bs += '<span class="badge b-g">✓ ' + c.totCov + '</span>';
    bs += '<span class="badge b-x">' + c.sos.length + ' הזמנות</span>';

    var soHtml = '';
    var sortedSos = c.sos.slice().sort(function(a, b) {
      const o = { r: 0, o: 1, g: 2 };
      const at = a.ovr > 0 ? 'r' : a.unc > 0 ? 'o' : 'g';
      const bt = b.ovr > 0 ? 'r' : b.unc > 0 ? 'o' : 'g';
      return (o[at] - o[bt]) || b.ovr - a.ovr;
    });
    sortedSos.forEach(function(g) {
      const gid = 'so_ssp_' + g.so.replace(/\W/g, '_');
      const gtl = g.ovr > 0 ? 'r' : g.unc > 0 ? 'o' : 'g';
      const ds = g.minDate ? fd(g.minDate) + (g.maxDate && g.maxDate.getTime() !== g.minDate.getTime() ? '–' + fd(g.maxDate) : '') : '—';
      const dc = g.minDate && g.minDate < TODAY ? 'past' : (g.minDate && g.minDate - TODAY < 30 * 86400000 ? 'curr' : '');
      var gbs = '';
      if (g.ovr) gbs += '<span class="badge b-r">🔴 ' + g.ovr + '</span>';
      if (g.unc) gbs += '<span class="badge b-o">⚠ ' + g.unc + '</span>';
      if (g.cov) gbs += '<span class="badge b-g">✓ ' + g.cov + '</span>';
      gbs += '<span class="badge b-x">' + g.lines.length + '</span>';
      const matchedPO = g.lines.filter(function(r) { return poMPNs.has(r.mpn.trim().toUpperCase()); }).length;
      const supps = [...new Set(g.lines.map(function(r) { return r.supplier; }).filter(Boolean))];
      const suppTxt = supps.length ? supps.slice(0, 2).join(', ') : '—';
      const soKey = g.so.replace(/'/g, "\\'");
      soHtml += '<div class="so-row" onclick="togSODetail(\'' + gid + '\')">'
        + '<span></span>'
        + '<span class="so-row-dot tl-' + gtl + '"></span>'
        + '<div><span class="so-row-num" onclick="event.stopPropagation();openSOInEmp(\'' + soKey + '\')" style="cursor:pointer" title="פתח ב מבט עובד">' + esc(g.so) + '</span><span class="so-row-cpo">' + esc(g.custPO) + '</span></div>'
        + '<span class="ddate ' + dc + '" style="font-size:11px;white-space:nowrap">' + ds + '</span>'
        + '<div style="display:flex;gap:4px">' + gbs + '</div>'
        + '<div class="so-chev" id="chev_' + gid + '">▼</div>'
        + '</div>'
        + '<div class="so-detail-card" id="det_' + gid + '" style="display:none">'
          + '<div class="so-stat-grid">'
            + '<div class="so-stat"><div class="so-stat-lbl">סה&quot;כ פריטים</div><div class="so-stat-val">' + g.lines.length + '</div></div>'
            + (g.ovr ? '<div class="so-stat s-red"><div class="so-stat-lbl">באיחור ללא כיסוי</div><div class="so-stat-val">' + g.ovr + '</div></div>' : '<div class="so-stat"><div class="so-stat-lbl">באיחור ללא כיסוי</div><div class="so-stat-val" style="color:var(--grn)">0</div></div>')
            + '<div class="so-stat"><div class="so-stat-lbl">ספקים</div><div class="so-stat-val" style="font-size:12px">' + suppTxt + '</div></div>'
            + '<div class="so-stat"><div class="so-stat-lbl">התאמות PO</div><div class="so-stat-val" style="color:' + (matchedPO > 0 ? 'var(--acc)' : 'var(--txt2)') + '">' + matchedPO + '</div></div>'
          + '</div>'
          + '<div class="so-actions">'
            + '<button class="so-action-link" onclick="event.stopPropagation();openSOInEmp(\'' + soKey + '\')">📋 פתח במבט עובד</button>'
          + '</div>'
        + '</div>';
    });

    html2 += '<div class="cg-hdr" onclick="togCG(\'' + cid + '\')">'
      + '<span class="cg-dot ' + tlC + '"></span>'
      + '<span class="cg-name">' + esc(sname) + '</span>'
      + '<div class="so-chev" id="chev_' + cid + '">▼</div>'
      + '<div class="cg-badges">' + bs + '</div>'
      + '</div>'
      + '<div class="cg-body" id="' + cid + '">' + soHtml + '</div>';
  });
  el.innerHTML = html2;

  if (!state.sspAllOpen && custArr.length > SHOW) {
    document.getElementById('ssp-more').style.display = 'flex';
    document.getElementById('ssp-more-txt').textContent = 'מציג ' + SHOW + ' מתוך ' + custArr.length + ' לקוחות';
  } else {
    document.getElementById('ssp-more').style.display = 'none';
  }
}

export function toggleSSP() {
  state.sspOpen = !state.sspOpen;
  document.getElementById('ssp-body').classList.toggle('open', state.sspOpen);
  document.getElementById('ssp-chev').textContent = state.sspOpen ? '▲' : '▼';
}

export function togCG(id) {
  document.getElementById('ssp-list').querySelectorAll('.cg-body').forEach(function(el) {
    if (el.id !== id) {
      el.classList.remove('open');
      var chev = document.getElementById('chev_' + el.id);
      if (chev) chev.classList.remove('open');
    }
  });
  var el = document.getElementById(id);
  var chev = document.getElementById('chev_' + id);
  var isOpen = el.classList.contains('open');
  el.classList.toggle('open', !isOpen);
  if (chev) chev.classList.toggle('open', !isOpen);
}

export function togSODetail(id) {
  var det = document.getElementById('det_' + id);
  var chev = document.getElementById('chev_' + id);
  if (!det) return;
  var isOpen = det.style.display === 'block';
  det.closest('.cg-body').querySelectorAll('[id^="det_so_ssp_"]').forEach(function(el) {
    if (el.id !== det.id) {
      el.style.display = 'none';
      var c = document.getElementById('chev_' + el.id.replace('det_', ''));
      if (c) c.classList.remove('open');
    }
  });
  det.style.display = isOpen ? 'none' : 'block';
  if (chev) chev.classList.toggle('open', !isOpen);
  if (!isOpen) expandNotes(det);
}

export function sspShowAll() { state.sspAllOpen = true; renderSSP(); }
