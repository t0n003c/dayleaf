import crypto from 'node:crypto';
import { authenticator } from 'otplib';
import { db } from './db.js';

const SESSION_COOKIE = 'dayleaf_session';
const SESSION_DAYS = 30;

// --- password hashing (scrypt, no native deps) ---

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// --- sessions ---

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Secure by default (TLS terminates at Cloudflare). Set COOKIE_INSECURE=1 only
// for pure plain-HTTP LAN deployments, where browsers would otherwise drop the
// Secure cookie and login would silently fail.
const COOKIE_SECURE = process.env.COOKIE_INSECURE === '1' ? '' : ' Secure;';

function setSessionCookie(res, value, maxAge) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly;${COOKIE_SECURE} SameSite=Lax; Max-Age=${maxAge}`
  );
}

export function currentToken(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token, userId, expires.toISOString()
  );
  setSessionCookie(res, token, SESSION_DAYS * 86400);
}

export function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  setSessionCookie(res, '', 0);
}

export function getUser() {
  return db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get() || null;
}

export function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).get(token);
  return row || null;
}

export function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

// --- TOTP (Google Authenticator etc.) ---

export function newTotpSecret() {
  return authenticator.generateSecret();
}

export function totpUri(secret, username) {
  return authenticator.keyuri(username, 'Dayleaf', secret);
}

export function checkTotp(secret, code) {
  try {
    return authenticator.verify({ token: String(code || '').replace(/\s/g, ''), secret });
  } catch {
    return false;
  }
}
