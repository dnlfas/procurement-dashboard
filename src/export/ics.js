import { state } from '../state.js';
import { p2, fd, toast } from '../utils.js';

export function icsD(d) { return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()); }

export function dlSOICS(g) {
  if (!g) { toast('שגיאה'); return; }
  const lwd = g.lines.filter(l => l.dd);
  if (!lwd.length) { toast('אין תאריכי אספקה בהזמנה זו'); return; }
  state._icsGroup = g;
  const firstDd = [...lwd].sort((a, b) => a.dd - b.dd)[0].dd;
  document.getElementById('ics-summary').value = `תזכורת אספקה: ${g.so} | ${g.customer || ''} | ${lwd.length} פריטים | ${fd(firstDd)}`;
  document.getElementById('ics-event-date').value = '0';
  document.getElementById('ics-alert').value = '7d_abs';
  document.getElementById('ics-custom-date').style.display = 'none';
  document.getElementById('ics-custom-alarm').style.display = 'none';
  document.getElementById('ics-modal').style.display = 'flex';
}

export function closeICSModal() { document.getElementById('ics-modal').style.display = 'none'; }

export function icsUpdateCustomFields() {
  document.getElementById('ics-custom-date').style.display =
    document.getElementById('ics-event-date').value === 'custom' ? 'block' : 'none';
  document.getElementById('ics-custom-alarm').style.display =
    document.getElementById('ics-alert').value === 'custom' ? 'block' : 'none';
}

export function _icsPresetOnDay() {
  if (!state._icsGroup) return;
  _buildAndDownloadICS(state._icsGroup, { eventOffset: 0, alertType: '7d_abs', summary: document.getElementById('ics-summary').value.trim() });
  closeICSModal();
}

export function _icsPreset7Before() {
  if (!state._icsGroup) return;
  _buildAndDownloadICS(state._icsGroup, { eventOffset: 7, alertType: 'at_start', summary: document.getElementById('ics-summary').value.trim() });
  closeICSModal();
}

export function _icsTaskToday() {
  if (!state._icsGroup) return;
  const g = state._icsGroup;
  const summary = document.getElementById('ics-summary').value.trim() || g.so;
  const now = new Date();
  const stamp = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) + 'T' + p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds()) + 'Z';
  const dateStr = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate());
  const uid = stamp + '-today-' + g.so + '@bts';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BTS//ProcurementDashboard//HE',
    'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp,
    'DTSTART:' + dateStr + 'T090000', 'DTEND:' + dateStr + 'T100000',
    'SUMMARY:' + summary,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + summary, 'TRIGGER:-PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'today_' + g.so + '.ics';
  a.click();
  closeICSModal();
  toast('אירוע "לטיפול היום" יוצא');
}

export function submitICSDownload() {
  if (!state._icsGroup) return;
  const eventSel = document.getElementById('ics-event-date').value;
  _buildAndDownloadICS(state._icsGroup, {
    eventOffset: eventSel === 'custom' ? 'custom' : parseInt(eventSel) || 0,
    customDate: document.getElementById('ics-custom-date').value,
    alertType: document.getElementById('ics-alert').value,
    customAlarm: document.getElementById('ics-custom-alarm').value,
    summary: document.getElementById('ics-summary').value.trim()
  });
  closeICSModal();
}

export function _buildAndDownloadICS(g, opts) {
  const lwd = g.lines.filter(l => l.dd);
  const now = new Date();
  const dts = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) + 'T' + p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds()) + 'Z';
  const byD = {};
  lwd.forEach(r => { const k = icsD(r.dd); if (!byD[k]) byD[k] = { dd: r.dd, lines: [] }; byD[k].lines.push(r); });
  const evts = Object.values(byD).map(gr => {
    let evtDate;
    if (opts.eventOffset === 'custom' && opts.customDate) { evtDate = new Date(opts.customDate); }
    else { const off = typeof opts.eventOffset === 'number' ? opts.eventOffset : 0; evtDate = new Date(gr.dd.getTime() - off * 86400000); }
    const es = icsD(evtDate), ee = icsD(new Date(evtDate.getTime() + 86400000));
    let trigger;
    if (opts.alertType === 'at_start') trigger = 'TRIGGER:-PT0M';
    else if (opts.alertType === '1d') trigger = 'TRIGGER:-P1D';
    else if (opts.alertType === '1w') trigger = 'TRIGGER:-P1W';
    else if (opts.alertType === '7d_abs') {
      const al = new Date(gr.dd.getTime() - 7 * 86400000);
      trigger = 'TRIGGER;VALUE=DATE-TIME:' + al.getFullYear() + p2(al.getMonth() + 1) + p2(al.getDate()) + 'T070000Z';
    } else if (opts.alertType === 'custom' && opts.customAlarm) {
      const dt = new Date(opts.customAlarm);
      trigger = 'TRIGGER;VALUE=DATE-TIME:' + dt.getUTCFullYear() + p2(dt.getUTCMonth() + 1) + p2(dt.getUTCDate()) + 'T' + p2(dt.getUTCHours()) + p2(dt.getUTCMinutes()) + '00Z';
    } else trigger = 'TRIGGER:-PT0M';
    const uid = `so-${g.so}-${es}-${Date.now()}@oo`.replace(/[^a-zA-Z0-9@\-]/g, '_');
    const sum = opts.summary || `תזכורת אספקה: ${g.so} | ${g.customer || ''} | ${gr.lines.length} פריטים | ${fd(gr.dd)}`;
    const desc = `הזמנה: ${g.so}\\nלקוח: ${g.customer || ''}\\nת. אספקה: ${fd(gr.dd)}\\n\\nפריטים:\\n` + gr.lines.map(r => `• ${r.mpn} — כמות: ${r.qtyR || r.qtyO} — ספק: ${r.supplier || '—'}`).join('\\n');
    return ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${dts}`, `DTSTART;VALUE=DATE:${es}`, `DTEND;VALUE=DATE:${ee}`, `SUMMARY:${sum}`, `DESCRIPTION:${desc}`, 'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT', 'BEGIN:VALARM', trigger, 'ACTION:DISPLAY', `DESCRIPTION:${sum}`, 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Open Orders Tracker//IL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...evts, 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  a.download = `reminder_${g.so.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('📅 ' + Object.keys(byD).length + ' אירוע/ים הורדו עבור ' + g.so);
}
