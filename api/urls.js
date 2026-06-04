const { list } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

module.exports = async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const { blobs } = await list({ prefix: 'procurement/' });
    const result = {};
    for (const b of blobs) {
      if (b.pathname === 'procurement/so.xlsx') result.soUrl = b.url;
      if (b.pathname === 'procurement/po.xlsx') result.poUrl = b.url;
    }
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
