const crypto = require('crypto');

const COOKIE = 'bts_auth';
const MAX_AGE = 7 * 24 * 3600;

function secret() {
  return process.env.SESSION_SECRET || 'dev-secret-change-me';
}

function sign(val) {
  const hmac = crypto.createHmac('sha256', secret()).update(val).digest('base64url');
  return val + '.' + hmac;
}

function verify(signed) {
  if (!signed) return false;
  const i = signed.lastIndexOf('.');
  if (i < 0) return false;
  const val = signed.slice(0, i);
  const expected = Buffer.from(sign(val));
  const actual = Buffer.from(signed);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual) ? val : false;
}

function getCookie(req) {
  const h = req.headers.cookie || '';
  const m = h.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return m ? m[1] : null;
}

function isAuthed(req) {
  return !!verify(getCookie(req));
}

function setAuthCookie(res) {
  const token = sign('ok.' + Date.now());
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}`);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

module.exports = { isAuthed, setAuthCookie, clearAuthCookie };
