const { put, list } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

// ?doc=rfq stores the RFQ list in its own blob (kept in this function to stay under Vercel's function limit)
const PATHNAMES = {
  overrides: 'procurement/overrides.json',
  rfq: 'procurement/rfq.json',
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });
  const doc = (req.query && req.query.doc) || 'overrides';
  const PATHNAME = PATHNAMES[doc];
  if (!PATHNAME) return res.status(400).json({ error: 'unknown doc' });

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
