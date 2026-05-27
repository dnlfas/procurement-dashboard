const { list } = require('@vercel/blob');

module.exports = async function handler(req, res) {
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
