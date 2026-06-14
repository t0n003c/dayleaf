import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';
import * as fsExtra from 'node:fs';
import { db, DATA_DIR, getSetting, setSetting } from './db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  getUser, sessionUser, requireAuth, newTotpSecret, totpUri, checkTotp, currentToken,
} from './auth.js';
import {
  registrationOptions, verifyRegistration, authenticationOptions,
  verifyAuthentication, listCredentials, deleteCredential,
} from './webauthn.js';
import { streamAnswer, streamRecap, testConnection, aiConfig } from './ai.js';
import {
  ensureVapid, saveSubscription, removeSubscription, sendToAll,
  reminderSettings, updateReminderSettings, startReminderLoop,
} from './push.js';
import { loginGate, recordAttempt, recentActivity, lockoutPolicy } from './security.js';
import { optimizeUpload, thumbFile, thumbName, backfillThumbnails } from './images.js';
import { shiftDate, targetsFor } from './memories.js';
import { streamBackup, restoreBackup } from './backup.js';
import pkg from '../package.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = join(DATA_DIR, 'uploads');

const app = express();
// Trust exactly the proxy hops in front of us (Cloudflare Tunnel -> NPM = 2).
// `true` would trust any X-Forwarded-For, letting a direct caller spoof its IP.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 2));
app.disable('x-powered-by');

// Security headers on every response.
app.use((_req, res, next) => {
  res.set({
    // The two hashes whitelist exactly the inline scripts in index.html: the
    // pre-paint theme setter and the service-worker registration. If either
    // script changes, its hash changes and the browser blocks it — the smoke
    // journey asserts there are no CSP violations, so drift is caught in CI.
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self' 'sha256-CH0jmaqZqesdpFdNeh9iAh/jt14dy6BmtkFyLZlvHFk=' " +
      "'sha256-xgtzMOFRePiwe4kFSwITE+9gUw0JyS0j8qvYarVJChA='; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; " +
      "object-src 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  });
  next();
});

// CSRF defense-in-depth: SameSite=Lax already blocks cross-site cookie sends,
// but also reject state-changing API requests whose Origin isn't our own.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // native apps / curl send no Origin; cookie+SameSite still gates browsers
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    if (new URL(origin).host !== String(host).split(',')[0].trim()) {
      return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
  } catch { return res.status(403).json({ error: 'Bad origin' }); }
  next();
});

app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    // .orig marks an unprocessed upload; optimizeUpload converts it to WebP
    filename: (_req, _file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}.orig`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 6 },
  // Raster images only — reject SVG (can carry script) and other image/* types
  // that aren't safe to round-trip.
  fileFilter: (_req, file, cb) =>
    cb(null, /^image\/(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(file.mimetype)),
});

async function storePhotos(entryId, files) {
  for (const f of files || []) {
    const stored = await optimizeUpload(f.path, UPLOAD_DIR, f.mimetype);
    db.prepare('INSERT INTO attachments (entry_id, filename, original_name, mime, size) VALUES (?, ?, ?, ?, ?)')
      .run(entryId, stored.filename, f.originalname, stored.mime, stored.size);
  }
}

function discardUploads(files) {
  for (const f of files || []) {
    try { unlinkSync(f.path); } catch {}
  }
}

function removeStoredFile(filename) {
  try { unlinkSync(join(UPLOAD_DIR, filename)); } catch {}
  try { unlinkSync(thumbFile(UPLOAD_DIR, filename)); } catch {}
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function rejectLocked(res, gate) {
  res.set('Retry-After', String(gate.retryAfterSec));
  const mins = Math.ceil(gate.retryAfterSec / 60);
  res.status(429).json({
    error: `Too many failed attempts — sign-in is locked for ${mins} more minute${mins === 1 ? '' : 's'}`,
  });
}

// ---------- auth ----------

app.get('/api/me', (req, res) => {
  const user = getUser();
  if (!user) return res.json({ needsSetup: true, authed: false });
  const session = sessionUser(req);
  res.json({
    needsSetup: false,
    authed: !!session,
    username: session ? getSetting('display_name') || session.username : undefined,
    totpEnabled: !!user.totp_enabled,
    hasPasskeys: listCredentials().length > 0,
  });
});

app.put('/api/profile', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
  setSetting('display_name', name);
  res.json({ ok: true, name });
});

app.post('/api/setup', (req, res) => {
  if (getUser()) return res.status(400).json({ error: 'Already set up' });
  const { username, password } = req.body || {};
  if (!username?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and a password of at least 8 characters are required' });
  }
  const result = db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)')
    .run(username.trim(), hashPassword(password));
  createSession(res, Number(result.lastInsertRowid));
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  const gate = loginGate(req);
  if (gate.blocked) return rejectLocked(res, gate);
  const user = getUser();
  if (!user) return res.status(400).json({ error: 'Not set up yet' });
  const { password, totp } = req.body || {};
  if (!password || !verifyPassword(password, user.pass_hash)) {
    recordAttempt(req, 'password', false);
    await delay(400); // flat cost per failure to slow guessing
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (user.totp_enabled) {
    // Asking for the code isn't a failed attempt — it's step two of login.
    if (!totp) return res.status(401).json({ totpRequired: true });
    if (!checkTotp(user.totp_secret, totp)) {
      recordAttempt(req, '2fa code', false);
      await delay(400);
      return res.status(401).json({ totpRequired: true, error: 'Wrong authenticator code' });
    }
  }
  recordAttempt(req, user.totp_enabled ? 'password + 2fa' : 'password', true);
  createSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

app.post('/api/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !verifyPassword(current, req.user.pass_hash)) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  if (!next || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  // Evict every other session so a stolen token can't outlive a password change.
  const keep = currentToken(req);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, keep || '');
  res.json({ ok: true });
});

// ---------- security: activity log & sessions ----------

app.get('/api/security/activity', requireAuth, (_req, res) => {
  res.json({ attempts: recentActivity(10), policy: lockoutPolicy });
});

app.post('/api/security/logout-all', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions').run();
  destroySession(req, res);
  res.json({ ok: true });
});

// ---------- TOTP (Google Authenticator) ----------

app.post('/api/totp/setup', requireAuth, (req, res) => {
  const secret = newTotpSecret();
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, req.user.id);
  res.json({ secret, uri: totpUri(secret, req.user.username) });
});

app.post('/api/totp/enable', requireAuth, (req, res) => {
  const user = getUser();
  if (!user.totp_secret || !checkTotp(user.totp_secret, req.body?.code)) {
    return res.status(400).json({ error: 'Code does not match — scan the QR and try again' });
  }
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

app.post('/api/totp/disable', requireAuth, (req, res) => {
  const user = getUser();
  if (user.totp_enabled && !checkTotp(user.totp_secret, req.body?.code)) {
    return res.status(400).json({ error: 'Enter a current authenticator code to disable' });
  }
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

// ---------- WebAuthn / biometric passkeys ----------

app.post('/api/webauthn/register-options', requireAuth, async (req, res) => {
  try { res.json(await registrationOptions(req, req.user)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/webauthn/register-verify', requireAuth, async (req, res) => {
  try { await verifyRegistration(req, req.user, req.body); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/webauthn/login-options', async (req, res) => {
  try { res.json(await authenticationOptions(req)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/webauthn/login-verify', async (req, res) => {
  const gate = loginGate(req);
  if (gate.blocked) return rejectLocked(res, gate);
  try {
    const userId = await verifyAuthentication(req, req.body);
    recordAttempt(req, 'passkey', true);
    createSession(res, userId);
    res.json({ ok: true });
  } catch (e) {
    recordAttempt(req, 'passkey', false);
    await delay(400);
    res.status(401).json({ error: e.message });
  }
});

app.get('/api/webauthn/credentials', requireAuth, (_req, res) => res.json(listCredentials()));
app.delete('/api/webauthn/credentials/:id', requireAuth, (req, res) => {
  deleteCredential(req.params.id);
  res.json({ ok: true });
});

// ---------- tabs ----------

app.get('/api/tabs', requireAuth, (_req, res) => {
  res.json(db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM entries e WHERE e.tab_id = t.id) AS entry_count
    FROM tabs t ORDER BY t.position, t.id
  `).all());
});

app.post('/api/tabs', requireAuth, (req, res) => {
  const { name, emoji, color } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tabs').get().p;
  const r = db.prepare('INSERT INTO tabs (name, emoji, color, position) VALUES (?, ?, ?, ?)')
    .run(name.trim(), emoji || '📓', color || '#5b8c5a', pos);
  res.json(db.prepare('SELECT * FROM tabs WHERE id = ?').get(r.lastInsertRowid));
});

// NOTE: must be registered before /api/tabs/:id or "reorder" matches as an id.
app.put('/api/tabs/reorder', requireAuth, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
  const stmt = db.prepare('UPDATE tabs SET position = ? WHERE id = ?');
  ids.forEach((id, i) => stmt.run(i, Number(id)));
  res.json({ ok: true });
});

app.put('/api/tabs/:id', requireAuth, (req, res) => {
  const tab = db.prepare('SELECT * FROM tabs WHERE id = ?').get(req.params.id);
  if (!tab) return res.status(404).json({ error: 'No such tab' });
  const { name, emoji, color } = req.body || {};
  db.prepare('UPDATE tabs SET name = ?, emoji = ?, color = ? WHERE id = ?')
    .run(name?.trim() || tab.name, emoji || tab.emoji, color || tab.color, tab.id);
  res.json(db.prepare('SELECT * FROM tabs WHERE id = ?').get(tab.id));
});

app.delete('/api/tabs/:id', requireAuth, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS n FROM tabs').get().n;
  if (count <= 1) return res.status(400).json({ error: 'Keep at least one tab' });
  const files = db.prepare(
    'SELECT a.filename FROM attachments a JOIN entries e ON e.id = a.entry_id WHERE e.tab_id = ?'
  ).all(req.params.id);
  db.prepare('DELETE FROM tabs WHERE id = ?').run(req.params.id);
  for (const f of files) removeStoredFile(f.filename);
  res.json({ ok: true });
});

// ---------- entries ----------

function entryWithAttachments(row) {
  const attachments = db.prepare(
    'SELECT id, filename, mime FROM attachments WHERE entry_id = ? ORDER BY id'
  ).all(row.id);
  return { ...row, attachments };
}

app.get('/api/entries', requireAuth, (req, res) => {
  const { tab, q, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  let sql = 'SELECT e.*, t.name AS tab_name, t.emoji AS tab_emoji, t.color AS tab_color FROM entries e JOIN tabs t ON t.id = e.tab_id WHERE 1=1';
  const params = [];
  if (tab) { sql += ' AND e.tab_id = ?'; params.push(Number(tab)); }
  if (q) { sql += ' AND e.content LIKE ?'; params.push(`%${q}%`); }
  if (from) { sql += ' AND e.entry_date >= ?'; params.push(from); }
  if (to) { sql += ' AND e.entry_date <= ?'; params.push(to); }
  sql += ' ORDER BY e.entry_date DESC, e.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  res.json(db.prepare(sql).all(...params).map(entryWithAttachments));
});

app.post('/api/entries', requireAuth, upload.array('photos'), async (req, res) => {
  const { tab_id, content, mood, entry_date } = req.body || {};
  const tab = db.prepare('SELECT id FROM tabs WHERE id = ?').get(Number(tab_id));
  if (!tab) { discardUploads(req.files); return res.status(400).json({ error: 'Pick a tab' }); }
  if (!content?.trim() && !(req.files || []).length) {
    return res.status(400).json({ error: 'Write something or attach a photo' });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(entry_date || '') ? entry_date : new Date().toISOString().slice(0, 10);
  const r = db.prepare('INSERT INTO entries (tab_id, content, mood, entry_date) VALUES (?, ?, ?, ?)')
    .run(tab.id, (content || '').trim(), mood || null, date);
  await storePhotos(Number(r.lastInsertRowid), req.files);
  const row = db.prepare(
    'SELECT e.*, t.name AS tab_name, t.emoji AS tab_emoji, t.color AS tab_color FROM entries e JOIN tabs t ON t.id = e.tab_id WHERE e.id = ?'
  ).get(r.lastInsertRowid);
  res.json(entryWithAttachments(row));
});

app.put('/api/entries/:id', requireAuth, upload.array('photos'), async (req, res) => {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (!entry) { discardUploads(req.files); return res.status(404).json({ error: 'No such entry' }); }
  const { content, mood, entry_date, tab_id } = req.body || {};
  db.prepare(
    "UPDATE entries SET content = ?, mood = ?, entry_date = ?, tab_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    content !== undefined ? String(content).trim() : entry.content,
    mood !== undefined ? (mood || null) : entry.mood,
    /^\d{4}-\d{2}-\d{2}$/.test(entry_date || '') ? entry_date : entry.entry_date,
    tab_id ? Number(tab_id) : entry.tab_id,
    entry.id
  );
  await storePhotos(entry.id, req.files);
  const row = db.prepare(
    'SELECT e.*, t.name AS tab_name, t.emoji AS tab_emoji, t.color AS tab_color FROM entries e JOIN tabs t ON t.id = e.tab_id WHERE e.id = ?'
  ).get(entry.id);
  res.json(entryWithAttachments(row));
});

app.delete('/api/entries/:id', requireAuth, (req, res) => {
  const files = db.prepare('SELECT filename FROM attachments WHERE entry_id = ?').all(req.params.id);
  db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
  for (const f of files) removeStoredFile(f.filename);
  res.json({ ok: true });
});

app.get('/api/attachments', requireAuth, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const offset = Number(req.query.offset) || 0;
  const items = db.prepare(`
    SELECT a.id, a.filename, a.mime, a.size, a.created_at,
           e.id AS entry_id, e.entry_date, e.mood, substr(e.content, 1, 240) AS snippet,
           t.name AS tab_name, t.emoji AS tab_emoji, t.color AS tab_color
    FROM attachments a
    JOIN entries e ON e.id = a.entry_id
    JOIN tabs t ON t.id = e.tab_id
    ORDER BY e.entry_date DESC, a.id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n;
  res.json({ total, items });
});

app.delete('/api/attachments/:id', requireAuth, (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (a) {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    removeStoredFile(a.filename);
  }
  res.json({ ok: true });
});

app.get('/api/files/:name', requireAuth, (req, res) => {
  // basename() strips any path component; the regex then whitelists the
  // charset, so the result can never escape UPLOAD_DIR.
  const name = basename(req.params.name).replace(/[^a-z0-9.]/gi, '');
  if (!name || name.startsWith('.')) return res.status(404).end();
  // Never let a stored file be interpreted as active content.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  if (req.query.thumb) {
    const thumb = join(UPLOAD_DIR, 'thumbs', thumbName(name));
    if (existsSync(thumb)) {
      res.type('image/webp');
      return res.sendFile(thumb);
    }
  }
  const path = join(UPLOAD_DIR, name);
  if (!existsSync(path)) return res.status(404).end();
  res.sendFile(path);
});

// ---------- stats & memories ----------

// Clients pass ?today=YYYY-MM-DD because entry dates are in the user's local
// timezone while the server may run in UTC.
function clientToday(req) {
  const t = String(req.query.today || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : new Date().toISOString().slice(0, 10);
}

app.get('/api/stats', requireAuth, (req, res) => {
  const today = clientToday(req);
  const days = new Set(db.prepare('SELECT DISTINCT entry_date AS d FROM entries').all().map((r) => r.d));
  let streak = 0;
  // A streak is alive if you wrote today OR yesterday (today isn't over yet).
  let cursor = days.has(today) ? today : shiftDate(today, { days: 1 });
  while (days.has(cursor)) {
    streak++;
    cursor = shiftDate(cursor, { days: 1 });
  }
  res.json({
    streak,
    daysJournaled: days.size,
    totalEntries: db.prepare('SELECT COUNT(*) AS n FROM entries').get().n,
  });
});

app.get('/api/onthisday', requireAuth, (req, res) => {
  const today = clientToday(req);
  const out = [];
  for (const t of targetsFor(today)) {
    const entries = db.prepare(
      'SELECT e.*, tb.name AS tab_name, tb.emoji AS tab_emoji, tb.color AS tab_color FROM entries e JOIN tabs tb ON tb.id = e.tab_id WHERE e.entry_date = ? ORDER BY e.created_at'
    ).all(t.date);
    if (entries.length) out.push({ ...t, entries: entries.map(entryWithAttachments) });
  }
  res.json(out);
});

// ---------- AI ----------

app.get('/api/settings/ai', requireAuth, (_req, res) => {
  const cfg = aiConfig();
  res.json({ baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey });
});

app.put('/api/settings/ai', requireAuth, (req, res) => {
  const { baseUrl, apiKey, model } = req.body || {};
  if (baseUrl !== undefined) setSetting('ai_base_url', String(baseUrl).trim());
  if (model !== undefined) setSetting('ai_model', String(model).trim());
  if (apiKey !== undefined && apiKey !== '') setSetting('ai_api_key', String(apiKey).trim());
  if (apiKey === '') setSetting('ai_api_key', '');
  res.json({ ok: true });
});

app.post('/api/ai/test', requireAuth, async (_req, res) => {
  try { await testConnection(); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/ask', requireAuth, async (req, res) => {
  const { question, tabIds, from, to } = req.body || {};
  if (!question?.trim()) return res.status(400).json({ error: 'Ask a question' });
  try {
    await streamAnswer({ question: question.trim(), tabIds, from, to }, res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: `AI request failed: ${e.message}` });
    else res.end(`\n\n[error: ${e.message}]`);
  }
});

app.post('/api/recap', requireAuth, async (req, res) => {
  const { tabIds, from, to, lens } = req.body || {};
  try {
    await streamRecap({ tabIds, from, to, lens }, res);
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ error: `Recap failed: ${e.message}` });
    else res.end(`\n\n[error: ${e.message}]`);
  }
});

// ---------- daily reminder push notifications ----------

app.get('/api/push/vapid-key', requireAuth, (_req, res) => {
  res.json({ publicKey: ensureVapid() });
});

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  try {
    saveSubscription(req.body?.subscription);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});

app.get('/api/settings/reminder', requireAuth, (_req, res) => {
  res.json(reminderSettings());
});

app.put('/api/settings/reminder', requireAuth, (req, res) => {
  updateReminderSettings(req.body || {});
  res.json(reminderSettings());
});

app.post('/api/push/test', requireAuth, async (_req, res) => {
  const sent = await sendToAll({
    title: 'Dayleaf 🍃',
    body: 'Test notification — reminders are working!',
    url: '/',
  });
  if (sent === 0) return res.status(400).json({ error: 'No active subscriptions on this server yet' });
  res.json({ ok: true, sent });
});

// ---------- export ----------

app.get('/api/export', requireAuth, (_req, res) => {
  const tabs = db.prepare('SELECT * FROM tabs ORDER BY position').all();
  const entries = db.prepare('SELECT * FROM entries ORDER BY entry_date, created_at').all()
    .map(entryWithAttachments);
  res.setHeader('Content-Disposition', `attachment; filename="dayleaf-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), tabs, entries });
});

// ---------- full backup & restore (incl. photos) ----------

app.get('/api/backup', requireAuth, (_req, res) => {
  streamBackup(res, pkg.version);
});

// Restore uploads can be large (photos as base64) — accept via disk to bound
// memory, with a generous size cap.
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: DATA_DIR,
    filename: (_req, _file, cb) => cb(null, `restore-${crypto.randomBytes(8).toString('hex')}.tmp`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
});

app.post('/api/restore', requireAuth, restoreUpload.single('backup'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No backup file uploaded' });
  try {
    const buf = fsExtra.readFileSync(req.file.path);
    const result = restoreBackup(buf);
    // Photos were rewritten — regenerate any missing thumbnails in the background.
    backfillThumbnails(result.restoredNames, UPLOAD_DIR).catch(() => {});
    destroySession(req, res); // user row may have changed → force a fresh sign-in
    res.json({ ok: true, tabs: result.tabs, entries: result.entries, photos: result.photos });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    try { unlinkSync(req.file.path); } catch {}
  }
});

// ---------- static frontend ----------

const WEB_DIST = join(__dirname, '..', 'web', 'dist');
app.use(express.static(WEB_DIST));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));

startReminderLoop();

// Backfill thumbnails for photos uploaded before the WebP pipeline existed,
// and sweep stale .orig files (failed/interrupted uploads) older than a day.
setTimeout(() => {
  const filenames = db.prepare('SELECT filename FROM attachments').all().map((r) => r.filename);
  backfillThumbnails(filenames, UPLOAD_DIR).catch((e) => console.error('thumb backfill failed:', e.message));
  try {
    const { readdirSync, statSync } = fsExtra;
    for (const f of readdirSync(UPLOAD_DIR)) {
      if (f.endsWith('.orig') && Date.now() - statSync(join(UPLOAD_DIR, f)).mtimeMs > 86400_000) {
        try { unlinkSync(join(UPLOAD_DIR, f)); } catch {}
      }
    }
  } catch {}
}, 3000);

app.listen(PORT, () => {
  console.log(`Dayleaf listening on http://0.0.0.0:${PORT} (data in ${DATA_DIR})`);
});
