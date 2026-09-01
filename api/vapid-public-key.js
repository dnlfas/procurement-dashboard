module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  if (req.method !== 'GET') return res.status(405).end();
  if (!process.env.VAPID_PUBLIC_KEY) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
};
