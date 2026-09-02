import { state } from './state.js';
import { esc, fd, p2, toast } from './utils.js';

let _subscribed = false;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function ensurePushSubscription() {
  if (_subscribed) return true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('הדפדפן אינו תומך בהתראות Push');
    return false;
  }

  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('התראות לא אושרו — התזכורת תישמר אך לא תוצג');
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const r = await fetch('/api/vapid-public-key');
      if (!r.ok) { toast('שגיאה בהגדרת Push'); return false; }
      const { publicKey } = await r.json();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });

    _subscribed = true;
    return true;
  } catch (e) {
    toast('שגיאה בהרשמה להתראות: ' + e.message);
    return false;
  }
}

async function getReminders() {
  const r = await fetch('/api/po-reminders');
  if (!r.ok) return [];
  return r.json();
}

async function saveReminders(list) {
  await fetch('/api/po-reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  });
}

export function initNotifications() {
  // Push delivery is server-triggered (Vercel cron -> service worker) — nothing to poll client-side.
}

export async function openNotifyModal(poNum) {
  const rows = state.poRows.filter(r => r.poNum === poNum);
  if (!rows.length) { toast('שגיאה'); return; }
  const latest = rows.reduce((mx, r) => r.dd && (!mx || r.dd > mx) ? r.dd : mx, null);
  state._notifyPO = { poNum, latest };
  document.getElementById('notify-title').textContent = `🔔 תזכורת ל-PO ${poNum}`;
  document.getElementById('notify-latest').textContent = latest
    ? `תאריך אספקה אחרון: ${fd(latest)}`
    : 'אין תאריך אספקה זמין להזמנה זו';
  document.getElementById('notify-preset-week').disabled = !latest;
  document.getElementById('notify-preset-day').disabled = !latest;
  document.getElementById('notify-custom-dt').value = '';
  await renderNotifyList();
  document.getElementById('notify-modal').style.display = 'flex';
}

export function closeNotifyModal() {
  document.getElementById('notify-modal').style.display = 'none';
}

async function renderNotifyList() {
  if (!state._notifyPO) return;
  const el = document.getElementById('notify-list');
  const all = await getReminders();
  const mine = all.filter(r => r.poNum === state._notifyPO.poNum)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!mine.length) { el.innerHTML = '<div style="font-size:11px;color:var(--txt2)">אין תזכורות פעילות</div>'; return; }
  el.innerHTML = mine.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:6px 8px;background:var(--sur3);border-radius:6px">
    <span>${esc(r.label)} — ${new Date(r.at).toLocaleString('he-IL')}</span>
    <span style="display:flex;gap:4px">
      <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" title="הוסף ליומן" onclick="downloadReminderICS('${esc(r.poNum)}','${esc(r.label)}','${r.at}')">📅</button>
      <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="cancelReminder('${r.id}')">בטל</button>
    </span>
  </div>`).join('');
}

export function downloadReminderICS(poNum, label, atISO) {
  const when = new Date(atISO);
  const dtStart = when.getFullYear() + p2(when.getMonth() + 1) + p2(when.getDate()) + 'T' + p2(when.getHours()) + p2(when.getMinutes()) + '00';
  const end = new Date(when.getTime() + 30 * 60000);
  const dtEnd = end.getFullYear() + p2(end.getMonth() + 1) + p2(end.getDate()) + 'T' + p2(end.getHours()) + p2(end.getMinutes()) + '00';
  const now = new Date();
  const stamp = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) + 'T' + p2(now.getHours()) + p2(now.getMinutes()) + p2(now.getSeconds()) + 'Z';
  const uid = `po-reminder-${poNum}-${Date.now()}@bts`.replace(/[^a-zA-Z0-9@\-]/g, '_');
  const summary = `🔔 תזכורת אספקה — PO ${poNum}`;
  const desc = `${label} — הזמנת רכש ${poNum}`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BTS//ProcurementDashboard//HE', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp,
    'DTSTART:' + dtStart, 'DTEND:' + dtEnd,
    'SUMMARY:' + summary, 'DESCRIPTION:' + desc,
    'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT0M', 'DESCRIPTION:' + summary, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `po_reminder_${poNum.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('📅 קובץ יומן הורד');
}

async function scheduleReminder(poNum, whenDate, label) {
  // Persist the reminder even if the push subscription failed — it just won't be deliverable.
  await ensurePushSubscription();
  const reminders = await getReminders();
  reminders.push({
    id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    poNum, label, at: whenDate.toISOString(),
    title: `🔔 תזכורת אספקה — PO ${poNum}`,
    body: `${label} · תאריך אספקה אחרון: ${fd(state._notifyPO && state._notifyPO.latest)}`,
  });
  await saveReminders(reminders);
  await renderNotifyList();
  toast('התזכורת נקבעה');
}

export function notifyPreset(daysBefore) {
  const ctx = state._notifyPO;
  if (!ctx || !ctx.latest) return;
  const when = new Date(ctx.latest);
  when.setDate(when.getDate() - daysBefore);
  when.setHours(9, 0, 0, 0);
  const label = daysBefore === 7 ? 'שבוע לפני האספקה' : 'יום לפני האספקה';
  scheduleReminder(ctx.poNum, when, label);
}

export function notifyCustom() {
  const ctx = state._notifyPO;
  if (!ctx) return;
  const v = document.getElementById('notify-custom-dt').value;
  if (!v) { toast('בחר תאריך ושעה'); return; }
  const when = new Date(v);
  if (isNaN(when.getTime())) { toast('תאריך לא תקין'); return; }
  scheduleReminder(ctx.poNum, when, 'מותאם אישית');
}

export async function cancelReminder(id) {
  const reminders = await getReminders();
  await saveReminders(reminders.filter(r => r.id !== id));
  await renderNotifyList();
}
