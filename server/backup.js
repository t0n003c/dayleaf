import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { db, DATA_DIR } from './db.js';

// A Dayleaf backup is a single self-describing JSON file containing the whole
// journal — tabs, entries, attachment metadata, settings, the user row, AND the
// photos themselves (base64). Plain JSON is the most future-proof format we can
// offer: openable and parseable by anything, forever, with zero tooling. It is
// streamed out (bounded memory) and restored transactionally.

const UPLOAD_DIR = join(DATA_DIR, 'uploads');
const BACKUP_VERSION = 1;

export function streamBackup(res, appVersion = '') {
  const tabs = db.prepare('SELECT * FROM tabs ORDER BY position, id').all();
  const entries = db.prepare('SELECT * FROM entries ORDER BY id').all();
  const attachments = db.prepare('SELECT * FROM attachments ORDER BY id').all();
  const settings = db.prepare('SELECT key, value FROM settings').all();
  const users = db
    .prepare('SELECT id, username, pass_hash, totp_secret, totp_enabled, created_at FROM users')
    .all();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="dayleaf-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );

  const j = (v) => JSON.stringify(v);
  res.write(`{"app":"dayleaf","version":${BACKUP_VERSION},"appVersion":${j(appVersion)},"exportedAt":${j(new Date().toISOString())},`);
  res.write(`"tabs":${j(tabs)},`);
  res.write(`"entries":${j(entries)},`);
  res.write(`"attachments":${j(attachments)},`);
  res.write(`"settings":${j(settings)},`);
  res.write(`"users":${j(users)},`);
  // Photos one at a time so we never hold them all in memory at once.
  res.write(`"photos":[`);
  let first = true;
  for (const a of attachments) {
    const p = join(UPLOAD_DIR, a.filename);
    if (!existsSync(p)) continue;
    const b64 = readFileSync(p).toString('base64');
    res.write(`${first ? '' : ','}{"filename":${j(a.filename)},"data":${j(b64)}}`);
    first = false;
  }
  res.write(`]}`);
  res.end();
}

// Replaces ALL journal data with the backup's contents. Returns counts.
export function restoreBackup(buf) {
  let data;
  try {
    data = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('That file is not a valid Dayleaf backup.');
  }
  if (data.app !== 'dayleaf' || !Array.isArray(data.tabs) || !Array.isArray(data.entries)) {
    throw new Error('That file is not a Dayleaf backup.');
  }
  if (Number(data.version) > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of Dayleaf. Update first, then restore.');
  }

  db.exec('BEGIN');
  try {
    // children first (FK-safe), then re-insert parents first
    db.exec('DELETE FROM attachments; DELETE FROM entries; DELETE FROM tabs; DELETE FROM sessions;');

    const insTab = db.prepare('INSERT INTO tabs (id,name,emoji,color,position,created_at) VALUES (?,?,?,?,?,?)');
    for (const t of data.tabs) insTab.run(t.id, t.name, t.emoji, t.color, t.position ?? 0, t.created_at);

    const insEntry = db.prepare('INSERT INTO entries (id,tab_id,content,mood,entry_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
    for (const e of data.entries) insEntry.run(e.id, e.tab_id, e.content, e.mood ?? null, e.entry_date, e.created_at, e.updated_at);

    const insAtt = db.prepare('INSERT INTO attachments (id,entry_id,filename,original_name,mime,size,created_at) VALUES (?,?,?,?,?,?,?)');
    for (const a of data.attachments || []) insAtt.run(a.id, a.entry_id, a.filename, a.original_name ?? null, a.mime, a.size ?? 0, a.created_at);

    if (Array.isArray(data.settings)) {
      const s = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      for (const kv of data.settings) s.run(kv.key, kv.value);
    }
    if (Array.isArray(data.users) && data.users[0]) {
      const u = data.users[0];
      db.prepare(
        "UPDATE users SET username=?, pass_hash=?, totp_secret=?, totp_enabled=? WHERE id=(SELECT id FROM users ORDER BY id LIMIT 1)"
      ).run(u.username, u.pass_hash, u.totp_secret ?? null, u.totp_enabled ?? 0);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw new Error(`Restore failed (no changes made): ${e.message}`);
  }

  // Photos to disk (outside the DB transaction). Filenames are sanitized so a
  // tampered backup can't write outside the uploads directory.
  let photos = 0;
  const restoredNames = [];
  for (const ph of data.photos || []) {
    const safe = basename(String(ph.filename || '')).replace(/[^a-z0-9.]/gi, '');
    if (!safe || !ph.data) continue;
    try {
      writeFileSync(join(UPLOAD_DIR, safe), Buffer.from(ph.data, 'base64'));
      restoredNames.push(safe);
      photos++;
    } catch {}
  }
  return { tabs: data.tabs.length, entries: data.entries.length, photos, restoredNames };
}
