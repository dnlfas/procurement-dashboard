import { state } from './state.js';
import { esc, fd, toast } from './utils.js';

const REM_KEY = 'oo_po_reminders';
const CHECK_MS = 30000;

let reminders = [];
try { reminders = JSON.parse(localStorage.getItem(REM_KEY) || '[]'); } catch (e) { reminders = []; }

function persist() {
  try { localStorage.setItem(REM_KEY, JSON.stringify(reminders)); } catch (e) {}
}

function checkDue() {
  const now = Date.now();
  const due = reminders.filter(r => new Date(r.at).getTime() <= now);
  if (!due.length) return;
  reminders = reminders.filter(r => new Date(r.at).getTime() > now);
  persist();
  due.forEach(r => {
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification(r.title, { body: r.body });
      }
    } catch (e) {}
  });
  if (state._notifyPO && due.some(r => r.poNum === state._notifyPO.poNum)) renderNotifyList();
}

export function initNotifications() {
  setInterval(checkDue, CHECK_MS);
  checkDue();
}

export function openNotifyModal(poNum) {
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
  renderNotifyList();
  document.getElementById('notify-modal').style.display = 'flex';
}

export function closeNotifyModal() {
  document.getElementById('notify-modal').style.display = 'none';
}

function renderNotifyList() {
  if (!state._notifyPO) return;
  const el = document.getElementById('notify-list');
  const mine = reminders.filter(r => r.poNum === state._notifyPO.poNum)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!mine.length) { el.innerHTML = '<div style="font-size:11px;color:var(--txt2)">אין תזכורות פעילות</div>'; return; }
  el.innerHTML = mine.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:6px 8px;background:var(--sur3);border-radius:6px">
    <span>${esc(r.label)} — ${new Date(r.at).toLocaleString('he-IL')}</span>
    <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="cancelReminder('${r.id}')">בטל</button>
  </div>`).join('');
}

function requestPermissionThen(fn) {
  if (!window.Notification) { toast('הדפדפן אינו תומך בהתראות'); fn(false); return; }
  if (Notification.permission === 'granted') { fn(true); return; }
  if (Notification.permission === 'denied') { toast('התראות חסומות בדפדפן — התזכורת תישמר אך לא תוצג'); fn(false); return; }
  Notification.requestPermission().then(p => fn(p === 'granted'));
}

function scheduleReminder(poNum, whenDate, label) {
  requestPermissionThen(granted => {
    if (!granted) toast('התראות לא אושרו — התזכורת נשמרה אך לא תוצג');
    reminders.push({
      id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      poNum, label, at: whenDate.toISOString(),
      title: `🔔 תזכורת אספקה — PO ${poNum}`,
      body: `${label} · תאריך אספקה אחרון: ${fd(state._notifyPO && state._notifyPO.latest)}`,
    });
    persist();
    renderNotifyList();
    toast('התזכורת נקבעה');
  });
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

export function cancelReminder(id) {
  reminders = reminders.filter(r => r.id !== id);
  persist();
  renderNotifyList();
}
