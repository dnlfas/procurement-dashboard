const { isAuthed } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.json({ ok: isAuthed(req) });
};
