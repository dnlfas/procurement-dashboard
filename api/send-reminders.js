const { put, list } = require('@vercel/blob');
const webpush = require('web-push');

const REMINDERS_PATH = 'procurement/po-reminders.json';
const SUBS_PATH = 'procurement/push-subscriptions.json';

async function readJsonBlob(pathname, fallback) {
  const { blobs } = await list({ prefix: pathname });
  const blob = blobs.find(b => b.pathname === pathname);
  if (!blob) return fallback;
  const r = await fetch(blob.url + '?t=' + Date.now());
  if (!r.ok) return fallback;
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');

  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthenticated' });
    }
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return res.status(500).json({ error: 'VAPID keys not configured' });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    const reminders = await readJsonBlob(REMINDERS_PATH, []);
    let subs = await readJsonBlob(SUBS_PATH, []);

    const now = Date.now();
    const due = reminders.filter(r => new Date(r.at).getTime() <= now);
    const remaining = reminders.filter(r => new Date(r.at).getTime() > now);

    const deadEndpoints = new Set();
    let sent = 0;

    for (const reminder of due) {
      const payload = JSON.stringify({ title: reminder.title, body: reminder.body });
      for (const sub of subs) {
        try {
          await webpush.sendNotification(sub, payload);
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) deadEndpoints.add(sub.endpoint);
        }
      }
    }

    if (deadEndpoints.size) subs = subs.filter(s => !deadEndpoints.has(s.endpoint));

    if (due.length) {
      await put(REMINDERS_PATH, JSON.stringify(remaining), {
        access: 'public', addRandomSuffix: false, contentType: 'application/json',
      });
    }
    if (deadEndpoints.size) {
      await put(SUBS_PATH, JSON.stringify(subs), {
        access: 'public', addRandomSuffix: false, contentType: 'application/json',
      });
    }

    res.json({ ok: true, fired: due.length, sent, prunedSubscriptions: deadEndpoints.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
