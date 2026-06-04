const { setAuthCookie } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (req.method !== 'POST') return res.status(405).end();

  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { password } = JSON.parse(body);
    const expected = process.env.DASHBOARD_PASSWORD;

    if (!expected) return res.status(500).json({ error: 'DASHBOARD_PASSWORD not configured' });

    if (password !== expected) return res.status(401).json({ error: 'wrong' });

    setAuthCookie(res);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
