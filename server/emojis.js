import yauzl from 'yauzl';
import crypto from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './db.js';

export const EMOJI_DIR = join(DATA_DIR, 'emojis');
const DEFAULT_SOURCE = join(DATA_DIR, 'Thiings');
const ALLOWED_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif']);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

mkdirSync(EMOJI_DIR, { recursive: true });

function insideDataDir(path) {
  const rel = resolve(path).slice(resolve(DATA_DIR).length);
  return rel === '' || rel.startsWith(sep);
}

function sourcePath(input) {
  if (!input) return DEFAULT_SOURCE;
  const raw = String(input).trim();
  const resolved = resolve(raw.startsWith('/') ? raw : join(DATA_DIR, raw));
  if (!insideDataDir(resolved)) {
    throw new Error('Import path must be inside the Dayleaf data folder. On the NAS, /volume1/.../dayleaf-data maps to /data in the container.');
  }
  return resolved;
}

function findZipFiles(source) {
  if (!existsSync(source)) throw new Error(`No file or folder found at ${source}`);
  const st = statSync(source);
  if (st.isFile()) {
    if (source.toLowerCase().endsWith('.zip')) return [source];
    throw new Error('Import source must be a .zip file or a folder containing .zip files');
  }
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let child;
      try { child = statSync(p); } catch { continue; }
      if (child.isDirectory()) walk(p, depth + 1);
      else if (child.isFile() && p.toLowerCase().endsWith('.zip')) out.push(p);
    }
  };
  walk(source);
  if (out.length === 0) throw new Error(`No .zip files found in ${source}`);
  return out;
}

function safeName(entryName) {
  const ext = extname(entryName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  const base = basename(entryName, ext)
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'emoji';
  const hash = crypto.createHash('sha1').update(entryName).digest('hex').slice(0, 8);
  return `${base}-${hash}${ext === '.jpeg' ? '.jpg' : ext}`;
}

function openZip(path) {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolvePromise(zip)));
  });
}

function readEntry(zip, entry) {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolvePromise(stream)));
  });
}

async function importOneZip(path) {
  const zip = await openZip(path);
  let seen = 0;
  let imported = 0;
  let skipped = 0;

  return await new Promise((resolvePromise, reject) => {
    zip.on('error', reject);
    zip.on('end', () => resolvePromise({ imported, skipped, entries: seen }));
    zip.readEntry();
    zip.on('entry', async (entry) => {
      seen++;
      try {
        if (seen > MAX_FILES || /\/$/.test(entry.fileName) || entry.uncompressedSize > MAX_FILE_BYTES) {
          skipped++;
          zip.readEntry();
          return;
        }
        const name = safeName(entry.fileName);
        if (!name) {
          skipped++;
          zip.readEntry();
          return;
        }
        const dest = join(EMOJI_DIR, name);
        if (existsSync(dest)) {
          skipped++;
          zip.readEntry();
          return;
        }
        const stream = await readEntry(zip, entry);
        await pipeline(stream, createWriteStream(dest, { flags: 'wx' }));
        imported++;
      } catch {
        skipped++;
      }
      zip.readEntry();
    });
  });
}

export async function importEmojiZip(inputPath) {
  mkdirSync(EMOJI_DIR, { recursive: true });
  const source = sourcePath(inputPath);
  const zips = findZipFiles(source);
  const result = { source, zips: zips.map((z) => basename(z)), imported: 0, skipped: 0, entries: 0 };
  for (const zip of zips) {
    const r = await importOneZip(zip);
    result.imported += r.imported;
    result.skipped += r.skipped;
    result.entries += r.entries;
  }
  return result;
}

export function listEmojis({ q = '', limit = 80, offset = 0 } = {}) {
  mkdirSync(EMOJI_DIR, { recursive: true });
  const query = String(q || '').trim().toLowerCase();
  const files = readdirSync(EMOJI_DIR)
    .filter((name) => ALLOWED_EXT.has(extname(name).toLowerCase()))
    .filter((name) => !query || name.toLowerCase().includes(query))
    .sort((a, b) => a.localeCompare(b));
  const safeLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    total: files.length,
    items: files.slice(safeOffset, safeOffset + safeLimit).map((name) => ({
      name,
      url: `/api/emojis/${encodeURIComponent(name)}`,
    })),
  };
}

export function emojiFile(name) {
  const safe = basename(String(name || '')).replace(/[^a-z0-9._-]/gi, '');
  const ext = extname(safe).toLowerCase();
  if (!safe || safe.startsWith('.') || !ALLOWED_EXT.has(ext)) return null;
  const path = join(EMOJI_DIR, safe);
  return existsSync(path) ? path : null;
}
