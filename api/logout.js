const { clearAuthCookie } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (req.method !== 'POST') return res.status(405).end();
  clearAuthCookie(res);
  res.json({ ok: true });
};
