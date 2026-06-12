import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';
import { db, DATA_DIR, getSetting, setSetting } from './db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession,
  getUser, sessionUser, requireAuth, newTotpSecret, totpUri, checkTotp,
} from './auth.js';
import {
  registrationOptions, verifyRegistration, authenticationOptions,
  verifyAuthentication, listCredentials, deleteCredential,
} from './webauthn.js';
import { streamAnswer, testConnection, aiConfig } from './ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = join(DATA_DIR, 'uploads');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${crypto.randomBytes(12).toString('hex')}${extname(file.originalname || '').toLowerCase() || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// Simple login throttle: after 5 failures, wait 30s between attempts.
let failedLogins = 0;
let lastFailure = 0;
function throttled() {
  return failedLogins >= 5 && Date.now() - lastFailure < 30_000;
}
function loginFailed() { failedLogins++; lastFailure = Date.now(); }
function loginSucceeded() { failedLogins = 0; }

// ---------- auth ----------

app.get('/api/me', (req, res) => {
  const user = getUser();
  if (!user) return res.json({ needsSetup: true, authed: false });
  const session = sessionUser(req);
  res.json({
    needsSetup: false,
    authed: !!session,
    username: session?.username,
    totpEnabled: !!user.totp_enabled,
    hasPasskeys: listCredentials().length > 0,
  });
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

app.post('/api/login', (req, res) => {
  if (throttled()) return res.status(429).json({ error: 'Too many attempts — wait 30 seconds' });
  const user = getUser();
  if (!user) return res.status(400).json({ error: 'Not set up yet' });
  const { password, totp } = req.body || {};
  if (!password || !verifyPassword(password, user.pass_hash)) {
    loginFailed();
    return res.status(401).json({ error: 'Wrong password' });
  }
  if (user.totp_enabled) {
    if (!totp) return res.status(401).json({ totpRequired: true });
    if (!checkTotp(user.totp_secret, totp)) {
      loginFailed();
      return res.status(401).json({ totpRequired: true, error: 'Wrong authenticator code' });
    }
  }
  loginSucceeded();
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
  if (throttled()) return res.status(429).json({ error: 'Too many attempts — wait 30 seconds' });
  try {
    const userId = await verifyAuthentication(req, req.body);
    loginSucceeded();
    createSession(res, userId);
    res.json({ ok: true });
  } catch (e) {
    loginFailed();
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
  res.json(db.prepare('SELECT * FROM tabs ORDER BY position, id').all());
});

app.post('/api/tabs', requireAuth, (req, res) => {
  const { name, emoji, color } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tabs').get().p;
  const r = db.prepare('INSERT INTO tabs (name, emoji, color, position) VALUES (?, ?, ?, ?)')
    .run(name.trim(), emoji || '📓', color || '#5b8c5a', pos);
  res.json(db.prepare('SELECT * FROM tabs WHERE id = ?').get(r.lastInsertRowid));
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
  for (const f of files) {
    try { unlinkSync(join(UPLOAD_DIR, f.filename)); } catch {}
  }
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

app.post('/api/entries', requireAuth, upload.array('photos'), (req, res) => {
  const { tab_id, content, mood, entry_date } = req.body || {};
  const tab = db.prepare('SELECT id FROM tabs WHERE id = ?').get(Number(tab_id));
  if (!tab) return res.status(400).json({ error: 'Pick a tab' });
  if (!content?.trim() && !(req.files || []).length) {
    return res.status(400).json({ error: 'Write something or attach a photo' });
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(entry_date || '') ? entry_date : new Date().toISOString().slice(0, 10);
  const r = db.prepare('INSERT INTO entries (tab_id, content, mood, entry_date) VALUES (?, ?, ?, ?)')
    .run(tab.id, (content || '').trim(), mood || null, date);
  for (const f of req.files || []) {
    db.prepare('INSERT INTO attachments (entry_id, filename, original_name, mime, size) VALUES (?, ?, ?, ?, ?)')
      .run(Number(r.lastInsertRowid), f.filename, f.originalname, f.mimetype, f.size);
  }
  const row = db.prepare(
    'SELECT e.*, t.name AS tab_name, t.emoji AS tab_emoji, t.color AS tab_color FROM entries e JOIN tabs t ON t.id = e.tab_id WHERE e.id = ?'
  ).get(r.lastInsertRowid);
  res.json(entryWithAttachments(row));
});

app.put('/api/entries/:id', requireAuth, upload.array('photos'), (req, res) => {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No such entry' });
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
  for (const f of req.files || []) {
    db.prepare('INSERT INTO attachments (entry_id, filename, original_name, mime, size) VALUES (?, ?, ?, ?, ?)')
      .run(entry.id, f.filename, f.originalname, f.mimetype, f.size);
  }
  const row = db.prepare(
    'SELECT e.*, t.name AS tab_name, t.emoji AS tab_emoji, t.color AS tab_color FROM entries e JOIN tabs t ON t.id = e.tab_id WHERE e.id = ?'
  ).get(entry.id);
  res.json(entryWithAttachments(row));
});

app.delete('/api/entries/:id', requireAuth, (req, res) => {
  const files = db.prepare('SELECT filename FROM attachments WHERE entry_id = ?').all(req.params.id);
  db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
  for (const f of files) {
    try { unlinkSync(join(UPLOAD_DIR, f.filename)); } catch {}
  }
  res.json({ ok: true });
});

app.delete('/api/attachments/:id', requireAuth, (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (a) {
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    try { unlinkSync(join(UPLOAD_DIR, a.filename)); } catch {}
  }
  res.json({ ok: true });
});

app.get('/api/files/:name', requireAuth, (req, res) => {
  const name = req.params.name.replace(/[^a-z0-9.]/gi, '');
  const path = join(UPLOAD_DIR, name);
  if (!existsSync(path)) return res.status(404).end();
  res.sendFile(path);
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

// ---------- export ----------

app.get('/api/export', requireAuth, (_req, res) => {
  const tabs = db.prepare('SELECT * FROM tabs ORDER BY position').all();
  const entries = db.prepare('SELECT * FROM entries ORDER BY entry_date, created_at').all()
    .map(entryWithAttachments);
  res.setHeader('Content-Disposition', `attachment; filename="dayleaf-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date().toISOString(), tabs, entries });
});

// ---------- static frontend ----------

const WEB_DIST = join(__dirname, '..', 'web', 'dist');
app.use(express.static(WEB_DIST));
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));

app.listen(PORT, () => {
  console.log(`Dayleaf listening on http://0.0.0.0:${PORT} (data in ${DATA_DIR})`);
});
