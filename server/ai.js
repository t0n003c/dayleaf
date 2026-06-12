import dns from 'node:dns/promises';
import net from 'node:net';
import { db, getSetting } from './db.js';

// Talks to any OpenAI-compatible chat completions API (OpenAI, OpenRouter,
// Ollama, LM Studio, Anthropic's compatibility endpoint, ...). The base URL,
// key and model all come from Settings, so the user brings their own provider.

// SSRF guard: the server fetches a user-set URL, and it sits inside the home
// LAN. Block private / loopback / link-local targets unless AI_ALLOW_PRIVATE=1
// (needed for a local Ollama/LM Studio on the same network).
const ALLOW_PRIVATE = process.env.AI_ALLOW_PRIVATE === '1';

function isBlockedIp(ip) {
  if (net.isIP(ip) === 0) return false;
  const v = ip.replace(/^::ffff:/i, '');
  if (/^(127\.|10\.|169\.254\.|192\.168\.)/.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(v)) return true; // CGNAT
  if (v === '::1' || /^f[cde]/i.test(v) || v === '0.0.0.0') return true; // ULA/link-local v6
  return false;
}

async function assertAllowed(baseUrl) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new Error('Invalid AI base URL'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('AI base URL must be http(s)');
  if (ALLOW_PRIVATE) return;
  // Resolve and check every A/AAAA record to defeat DNS-rebinding to internal IPs.
  let addrs;
  if (net.isIP(u.hostname)) addrs = [u.hostname];
  else {
    try { addrs = (await dns.lookup(u.hostname, { all: true })).map((a) => a.address); }
    catch { throw new Error('AI host could not be resolved'); }
  }
  if (addrs.some(isBlockedIp)) {
    throw new Error('AI base URL points to a private address (set AI_ALLOW_PRIVATE=1 for local providers)');
  }
}

const MAX_CONTEXT_CHARS = 120_000;
const MAX_ENTRIES = 400;

export function aiConfig() {
  return {
    baseUrl: (getSetting('ai_base_url', 'https://api.openai.com/v1') || '').replace(/\/+$/, ''),
    apiKey: getSetting('ai_api_key', ''),
    model: getSetting('ai_model', 'gpt-4o-mini'),
  };
}

function gatherEntries({ tabIds, from, to }) {
  let sql = `
    SELECT e.entry_date, e.content, e.mood, t.name AS tab_name,
           (SELECT COUNT(*) FROM attachments a WHERE a.entry_id = e.id) AS photos
    FROM entries e JOIN tabs t ON t.id = e.tab_id WHERE 1=1`;
  const params = [];
  if (Array.isArray(tabIds) && tabIds.length > 0) {
    sql += ` AND e.tab_id IN (${tabIds.map(() => '?').join(',')})`;
    params.push(...tabIds.map(Number));
  }
  if (from) { sql += ' AND e.entry_date >= ?'; params.push(from); }
  if (to) { sql += ' AND e.entry_date <= ?'; params.push(to); }
  sql += ' ORDER BY e.entry_date DESC, e.created_at DESC LIMIT ?';
  params.push(MAX_ENTRIES);
  return db.prepare(sql).all(...params);
}

function buildPrompt(question, scope) {
  const entries = gatherEntries(scope);
  let context = '';
  let included = 0;
  for (const e of entries) {
    const line = `[${e.entry_date}] (${e.tab_name}${e.mood ? `, mood: ${e.mood}` : ''}${e.photos ? `, ${e.photos} photo(s)` : ''})\n${e.content}\n\n`;
    if (context.length + line.length > MAX_CONTEXT_CHARS) break;
    context += line;
    included++;
  }
  const today = new Date().toISOString().slice(0, 10);
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const system = `You are the recall assistant inside Dayleaf, the user's private journal.
Today is ${weekday}, ${today}. Answer questions about the user's life using ONLY their journal entries below (newest first). Be warm, concise, and concrete — cite dates when helpful. If the journal doesn't contain the answer, say so honestly. Never invent events.

JOURNAL ENTRIES (${included} of ${entries.length} matching):
${context || '(no entries in the selected scope)'}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: question },
  ];
}

export async function streamAnswer({ question, tabIds, from, to }, res) {
  const { baseUrl, apiKey, model } = aiConfig();
  if (!apiKey && baseUrl.includes('api.openai.com')) {
    res.status(400).json({ error: 'No AI API key configured. Add one in Settings → AI.' });
    return;
  }
  const messages = buildPrompt(question, { tabIds, from, to });

  await assertAllowed(baseUrl);
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    res.status(502).json({ error: `AI provider error (${upstream.status}): ${text.slice(0, 500)}` });
    return;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) res.write(delta);
      } catch {
        // partial JSON across chunks is handled by the buffer; ignore stray lines
      }
    }
  }
  res.end();
}

export async function testConnection() {
  const { baseUrl, apiKey, model } = aiConfig();
  await assertAllowed(baseUrl);
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      max_tokens: 5,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Provider returned ${r.status}: ${text.slice(0, 300)}`);
  }
  return true;
}
