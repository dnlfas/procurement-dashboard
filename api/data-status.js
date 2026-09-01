const { list } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

async function blobUpdatedAt(pathname) {
  const { blobs } = await list({ prefix: pathname });
  const blob = blobs.find(b => b.pathname === pathname);
  return blob ? blob.uploadedAt : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const [soUpdatedAt, poUpdatedAt] = await Promise.all([
      blobUpdatedAt('procurement/so.xlsx'),
      blobUpdatedAt('procurement/po.xlsx'),
    ]);
    res.json({ soUpdatedAt, poUpdatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
