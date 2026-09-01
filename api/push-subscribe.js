const { put, list } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

const PATHNAME = 'procurement/push-subscriptions.json';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });
  if (req.method !== 'POST') return res.status(405).end();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const sub = JSON.parse(body);
    if (!sub || !sub.endpoint) { res.status(400).json({ error: 'invalid subscription' }); return; }

    let subs = [];
    const { blobs } = await list({ prefix: PATHNAME });
    const blob = blobs.find(b => b.pathname === PATHNAME);
    if (blob) {
      const r = await fetch(blob.url + '?t=' + Date.now());
      if (r.ok) subs = await r.json();
    }

    if (!subs.some(s => s.endpoint === sub.endpoint)) {
      subs.push(sub);
      await put(PATHNAME, JSON.stringify(subs), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
      });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
