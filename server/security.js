import { db, getSetting, setSetting } from './db.js';
import { sendToAll } from './push.js';

// Brute-force protection, persisted in SQLite so restarts don't reset it.
// Two layers: per-IP (stops one attacker) and global (stops distributed
// guessing against this single-user app). All thresholds env-tunable.

const MAX_IP_FAILS = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const MAX_GLOBAL_FAILS = Number(process.env.MAX_GLOBAL_ATTEMPTS || 15);
const WINDOW_MIN = Number(process.env.LOGIN_WINDOW_MINUTES || 15);
const LOCKOUT_MIN = Number(process.env.LOCKOUT_MINUTES || 15);

db.exec(`
  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    method TEXT NOT NULL,
    success INTEGER NOT NULL,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_time ON login_attempts(created_at);
`);

export function clientIp(req) {
  // Cloudflare's header is the real visitor; req.ip honors X-Forwarded-For
  // (trust proxy is on) and falls back to the socket address.
  return String(req.headers['cf-connecting-ip'] || req.ip || 'unknown').split(',')[0].trim();
}

function failuresSince(windowExpr, ip = null) {
  let sql = `SELECT COUNT(*) AS n, MAX(created_at) AS last FROM login_attempts
             WHERE success = 0 AND created_at > datetime('now', ?)`;
  const params = [windowExpr];
  if (ip) { sql += ' AND ip = ?'; params.push(ip); }
  return db.prepare(sql).get(...params);
}

/** Check BEFORE verifying credentials. Returns { blocked, retryAfterSec }. */
export function loginGate(req) {
  const win = `-${WINDOW_MIN} minutes`;
  const ipStats = failuresSince(win, clientIp(req));
  const globalStats = failuresSince(win);
  const tripped =
    ipStats.n >= MAX_IP_FAILS ? ipStats :
    globalStats.n >= MAX_GLOBAL_FAILS ? globalStats : null;
  if (!tripped) return { blocked: false };
  const lockoutEnd = new Date(`${tripped.last.replace(' ', 'T')}Z`).getTime() + LOCKOUT_MIN * 60_000;
  const retryAfterSec = Math.max(1, Math.ceil((lockoutEnd - Date.now()) / 1000));
  if (Date.now() >= lockoutEnd) return { blocked: false };
  return { blocked: true, retryAfterSec };
}

export function recordAttempt(req, method, success) {
  const ip = clientIp(req);
  db.prepare(
    'INSERT INTO login_attempts (ip, method, success, user_agent) VALUES (?, ?, ?, ?)'
  ).run(ip, method, success ? 1 : 0, String(req.headers['user-agent'] || '').slice(0, 200));
  db.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now', '-30 days')").run();

  if (!success) alertIfLockedOut(ip);
}

function alertIfLockedOut(ip) {
  const fails = failuresSince(`-${WINDOW_MIN} minutes`, ip);
  if (fails.n < MAX_IP_FAILS) return;
  const lastAlert = Number(getSetting('lockout_alert_at') || 0);
  if (Date.now() - lastAlert < 3600_000) return; // at most one alert per hour
  setSetting('lockout_alert_at', String(Date.now()));
  sendToAll({
    title: 'Dayleaf 🛡️',
    body: `Repeated failed sign-in attempts from ${ip} — logins are cooling down for ${LOCKOUT_MIN} minutes.`,
    url: '/',
  }).catch(() => {});
}

export function recentActivity(limit = 10) {
  return db.prepare(
    'SELECT id, ip, method, success, user_agent, created_at FROM login_attempts ORDER BY id DESC LIMIT ?'
  ).all(Math.min(limit, 50));
}

export const lockoutPolicy = {
  maxIpFails: MAX_IP_FAILS,
  maxGlobalFails: MAX_GLOBAL_FAILS,
  windowMinutes: WINDOW_MIN,
  lockoutMinutes: LOCKOUT_MIN,
};
