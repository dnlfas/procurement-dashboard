const { put, list } = require('@vercel/blob');
const { isAuthed } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthenticated' });

  const { type } = req.query;
  if (type !== 'so' && type !== 'po') {
    res.status(400).json({ error: 'type must be so or po' }); return;
  }

  const fileLastModified = parseInt(req.headers['x-file-lastmodified'] || '0');
  const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
  const pathname = `procurement/${type}.${format}`;

  try {
    // "If newer" check — compare file's lastModified against when blob was last uploaded
    if (fileLastModified) {
      const { blobs } = await list({ prefix: pathname });
      const existing = blobs.find(b => b.pathname === pathname);
      if (existing) {
        const uploadedAt = new Date(existing.uploadedAt).getTime();
        if (fileLastModified <= uploadedAt) {
          res.status(409).json({ error: 'not_newer', uploadedAt: existing.uploadedAt });
          return;
        }
      }
    }

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
