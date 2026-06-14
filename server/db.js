import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DATA_DIR = resolve(process.env.DATA_DIR || '/data');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, 'uploads', 'thumbs'), { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'dayleaf.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    nickname TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📓',
    color TEXT NOT NULL DEFAULT '#5b8c5a',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tab_id INTEGER NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    mood TEXT,
    entry_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date);
  CREATE INDEX IF NOT EXISTS idx_entries_tab ON entries(tab_id);

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ---- schema migrations ----
// The CREATE TABLE IF NOT EXISTS block above is the FROZEN v0 baseline. Any
// future schema change (ALTER, new index, new table, data fix) goes here as an
// ordered, append-only migration — NEVER edit the baseline or an existing
// migration. Both fresh and existing databases run from their current
// `user_version` up to MIGRATIONS.length, each in its own transaction, so an
// upgrade can never half-apply or clash on an existing NAS database.
const MIGRATIONS = [
  // v1 — speed up attachment lookups (gallery + per-entry photo strips)
  (d) => d.exec('CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id)'),
];

function migrate() {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`); // v+1 is a controlled integer
      db.exec('COMMIT');
      console.log(`Applied DB migration ${v + 1}`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`DB migration ${v + 1} failed: ${e.message}`);
    }
  }
}
migrate();

const tabCount = db.prepare('SELECT COUNT(*) AS n FROM tabs').get();
if (tabCount.n === 0) {
  const ins = db.prepare('INSERT INTO tabs (name, emoji, color, position) VALUES (?, ?, ?, ?)');
  ins.run('Home', '🏠', '#5b8c5a', 0);
  ins.run('Work', '💼', '#4a6fa5', 1);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
