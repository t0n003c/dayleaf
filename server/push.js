import webpush from 'web-push';
import { db, getSetting, setSetting } from './db.js';
import { targetsFor } from './memories.js';

// Web Push daily reminders. VAPID keys are generated once and kept in the
// settings table, so they survive container restarts (they must: subscriptions
// are bound to the public key).

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export function ensureVapid() {
  let publicKey = getSetting('vapid_public');
  let privateKey = getSetting('vapid_private');
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting('vapid_public', publicKey);
    setSetting('vapid_private', privateKey);
  }
  webpush.setVapidDetails('mailto:dayleaf@selfhosted.local', publicKey, privateKey);
  return publicKey;
}

export function saveSubscription(subscription) {
  if (!subscription?.endpoint) throw new Error('Invalid subscription');
  db.prepare(
    'INSERT INTO push_subscriptions (endpoint, data) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET data = excluded.data'
  ).run(subscription.endpoint, JSON.stringify(subscription));
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function subscriptionCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get().n;
}

export async function sendToAll(payload) {
  ensureVapid();
  const subs = db.prepare('SELECT * FROM push_subscriptions').all();
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(payload));
      sent++;
    } catch (e) {
      // 404/410 mean the browser dropped the subscription — clean it up.
      if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(s.endpoint);
    }
  }
  return sent;
}

export function reminderSettings() {
  return {
    enabled: getSetting('reminder_enabled') === '1',
    time: getSetting('reminder_time') || '20:00',
    tz: getSetting('reminder_tz') || 'UTC',
    memories: getSetting('memories_enabled') === '1',
    subscriptions: subscriptionCount(),
  };
}

export function updateReminderSettings({ enabled, time, tz, memories }) {
  if (enabled !== undefined) setSetting('reminder_enabled', enabled ? '1' : '0');
  if (memories !== undefined) setSetting('memories_enabled', memories ? '1' : '0');
  if (time !== undefined && /^\d{2}:\d{2}$/.test(time)) setSetting('reminder_time', time);
  if (tz !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz }); // validates the IANA name
      setSetting('reminder_tz', tz);
    } catch {}
  }
}

function localParts(tz) {
  // 'sv' locale formats as "YYYY-MM-DD HH:MM" — easy to split.
  const formatted = new Intl.DateTimeFormat('sv', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const [date, time] = formatted.split(' ');
  return { date, time };
}

const REMINDER_BODIES = [
  'What made you smile today?',
  'A minute for today’s page?',
  'What do you want to remember about today?',
  'How did today really go?',
  'Capture a little moment before the day ends.',
];

const MEMORIES_TIME = '09:00';

async function memoriesTick(parts) {
  if (getSetting('memories_enabled') !== '1' || subscriptionCount() === 0) return;
  if (parts.time !== MEMORIES_TIME) return;
  if (getSetting('memories_last_sent') === parts.date) return;
  setSetting('memories_last_sent', parts.date);
  const targets = targetsFor(parts.date);
  let total = 0;
  let first = null;
  for (const t of targets) {
    const rows = db.prepare('SELECT content FROM entries WHERE entry_date = ?').all(t.date);
    total += rows.length;
    if (!first && rows.length) first = { label: t.label, content: rows[0].content };
  }
  if (total === 0 || !first) return;
  const snippet = first.content.slice(0, 80).replace(/\s+/g, ' ');
  await sendToAll({
    title: 'Dayleaf 🍂',
    body: `${total} ${total === 1 ? 'memory' : 'memories'} from this day — ${first.label}: “${snippet}${first.content.length > 80 ? '…' : ''}”`,
    url: '/',
  });
}

async function tick() {
  const cfg = reminderSettings();
  if (cfg.subscriptions === 0) return;
  let parts;
  try { parts = localParts(cfg.tz); } catch { parts = localParts('UTC'); }
  await memoriesTick(parts).catch(() => {});
  if (!cfg.enabled) return;
  if (parts.time !== cfg.time) return;
  if (getSetting('reminder_last_sent') === parts.date) return;
  setSetting('reminder_last_sent', parts.date); // claim the slot before sending to avoid duplicates
  const wroteToday = db.prepare('SELECT 1 FROM entries WHERE entry_date = ? LIMIT 1').get(parts.date);
  if (wroteToday) return; // already journaled — no nagging
  const body = REMINDER_BODIES[new Date(parts.date).getDate() % REMINDER_BODIES.length];
  await sendToAll({ title: 'Dayleaf 🍃', body, url: '/?action=new' });
}

export function startReminderLoop() {
  setInterval(() => tick().catch((e) => console.error('reminder tick failed:', e.message)), 30_000);
}
