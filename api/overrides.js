const { put, list } = require('@vercel/blob');

const PATHNAME = 'procurement/overrides.json';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');

  if (req.method === 'GET') {
    try {
      const { blobs } = await list({ prefix: PATHNAME });
      const blob = blobs.find(b => b.pathname === PATHNAME);
      if (!blob) { res.json({}); return; }
      const r = await fetch(blob.url + '?t=' + Date.now());
      if (!r.ok) { res.json({}); return; }
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
      JSON.parse(body); // validate JSON before storing
      await put(PATHNAME, body, {
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
