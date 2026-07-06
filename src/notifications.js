import { state, NOTIF_KEY, NOTIF_ENABLED_KEY } from './state.js';
import { toast } from './utils.js';
import { setMainView } from './nav.js';

const LEAD_MS = 3 * 86400000;
const CHECK_INTERVAL_MS = 60000;

export function isSupported() { return typeof Notification !== 'undefined'; }
export function isEnabled() { return !!state.notifEnabled; }

function saveSeen() {
  try { localStorage.setItem(NOTIF_KEY, JSON.stringify(state.notifSeen)); } catch(e) {}
}

function saveEnabled() {
  try { localStorage.setItem(NOTIF_ENABLED_KEY, state.notifEnabled ? '1' : '0'); } catch(e) {}
}

export function updateBellUI() {
  const btn = document.getElementById('notif-bell');
  if (!btn) return;
  if (!isSupported()) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  const perm = Notification.permission;
  if (perm === 'denied') {
    btn.textContent = '🔕';
    btn.style.opacity = '.35';
    btn.style.color = 'var(--red)';
    btn.title = 'התראות חסומות בדפדפן — יש לאפשר בהגדרות האתר';
  } else if (perm === 'granted' && state.notifEnabled) {
    btn.textContent = '🔔';
    btn.style.opacity = '1';
    btn.style.color = 'var(--acc)';
    btn.title = 'התראות פעילות — לחץ להשתקה';
  } else if (perm === 'granted') {
    btn.textContent = '🔕';
    btn.style.opacity = '.6';
    btn.style.color = '';
    btn.title = 'התראות מושתקות — לחץ להפעלה';
  } else {
    btn.textContent = '🔔';
    btn.style.opacity = '.6';
    btn.style.color = '';
    btn.title = 'הפעל התראות על מועדי אספקה';
  }
}

function rowBucket(r, today) {
  if (!r.dd || r.cov === 'green') return null;
  if (r.status === 'cancelled' || r.status === 'cancelled_bts' || r.status === 'supplied') return null;
  if (r.isOvr) return 'overdue';
  const diff = r.dd - today;
  if (diff >= 0 && diff <= LEAD_MS) return 'duesoon';
  return null;
}

export function pruneNotifSeen() {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const live = new Set();
  state.allRows.forEach(r => { if (rowBucket(r, today)) live.add(r.nk); });
  let changed = false;
  Object.keys(state.notifSeen).forEach(nk => {
    if (!live.has(nk)) { delete state.notifSeen[nk]; changed = true; }
  });
  if (changed) saveSeen();
}

export function checkImportantDates() {
  if (!isSupported() || !isEnabled() || Notification.permission !== 'granted') return;
  if (!state.allRows.length) return;

  const today = new Date(new Date().setHours(0, 0, 0, 0));
  let ovrCount = 0, soonCount = 0;
  const newlySeen = {};

  state.allRows.forEach(r => {
    const bucket = rowBucket(r, today);
    if (!bucket) return;
    if (bucket === 'overdue') ovrCount++; else soonCount++;
    if (state.notifSeen[r.nk] !== bucket) newlySeen[r.nk] = bucket;
  });

  if (Object.keys(newlySeen).length) {
    let body;
    if (ovrCount && soonCount) body = `${ovrCount} פריטים באיחור, ${soonCount} פריטים מתקרבים למועד אספקה`;
    else if (ovrCount) body = `${ovrCount} פריטים באיחור באספקה`;
    else body = `${soonCount} פריטים מתקרבים למועד אספקה`;

    const notif = new Notification('⏰ פריטים דחופים', {
      body, requireInteraction: true, tag: 'bts-important-dates', icon: '/icon.png'
    });
    notif.onclick = () => { window.focus(); setMainView('boss'); notif.close(); };

    Object.assign(state.notifSeen, newlySeen);
    saveSeen();
  }

  pruneNotifSeen();
}

export function startNotifTimer() {
  stopNotifTimer();
  checkImportantDates();
  state._notifTimer = setInterval(checkImportantDates, CHECK_INTERVAL_MS);
}

export function stopNotifTimer() {
  if (state._notifTimer) { clearInterval(state._notifTimer); state._notifTimer = null; }
}

function requestAndEnable() {
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      state.notifEnabled = true;
      saveEnabled();
      toast('✓ התראות הופעלו');
      startNotifTimer();
    } else if (perm === 'denied') {
      toast('התראות חסומות — יש לאפשר אותן דרך הגדרות האתר בדפדפן');
    }
    updateBellUI();
  });
}

export function toggleNotifications() {
  if (!isSupported()) return;
  const perm = Notification.permission;
  if (perm === 'denied') {
    toast('התראות חסומות — יש לאפשר אותן דרך הגדרות האתר בדפדפן');
    return;
  }
  if (perm === 'default') {
    requestAndEnable();
    return;
  }
  if (state.notifEnabled) {
    state.notifEnabled = false;
    saveEnabled();
    toast('🔕 התראות הושתקו');
    updateBellUI();
  } else {
    state.notifEnabled = true;
    saveEnabled();
    toast('✓ התראות הופעלו');
    updateBellUI();
    startNotifTimer();
  }
}

export function initNotifications() {
  updateBellUI();
  if (isSupported() && isEnabled() && Notification.permission === 'granted') {
    startNotifTimer();
  }
}
