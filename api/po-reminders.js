const { put, list } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

const PATHNAME = 'procurement/po-reminders.json';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });

  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: PATHNAME });
      const blob = blobs.find(b => b.pathname === PATHNAME);
      if (!blob) { res.json([]); return; }
      const r = await fetch(blob.url + '?t=' + Date.now());
      if (!r.ok) { res.json([]); return; }
      res.json(await r.json());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const reminders = JSON.parse(body);
      if (!Array.isArray(reminders)) { res.status(400).json({ error: 'expected an array' }); return; }
      await put(PATHNAME, JSON.stringify(reminders), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).end();
};
