const { put } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });

  const { type } = req.query;
  if (type !== 'so' && type !== 'po') {
    res.status(400).json({ error: 'type must be so or po' }); return;
  }

  const pathname = `procurement/${type}.xlsx`;

  try {
    const blob = await put(pathname, req, {
      access: 'public',
      addRandomSuffix: false,
    });

    res.json({ url: blob.url, uploadedAt: blob.uploadedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports.config = { api: { bodyParser: false } };
