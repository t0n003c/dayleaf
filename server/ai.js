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

// Roughly 4 chars/token; 200k chars ≈ ~50k tokens, comfortable for modern
// large-context models (Claude 200k, GPT-4o 128k). Tune with AI_MAX_CONTEXT_CHARS.
const MAX_CONTEXT_CHARS = Number(process.env.AI_MAX_CONTEXT_CHARS || 200_000);
const MAX_ENTRIES = 800;

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
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: question },
    ],
    included,
    total: entries.length,
  };
}

// Parse an OpenAI-style SSE stream and write content deltas to res.
async function pipeDeltas(upstream, res) {
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
}

function chatBody(messages, extra = {}) {
  const { model } = aiConfig();
  return JSON.stringify({ model, messages, ...extra });
}

function authHeaders() {
  const { apiKey } = aiConfig();
  return { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

// One non-streaming completion → trimmed text. Used for the recap map phase.
async function aiText(messages, maxTokens = 500) {
  const { baseUrl } = aiConfig();
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: authHeaders(), body: chatBody(messages, { stream: false, max_tokens: maxTokens }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`AI provider error (${r.status}): ${t.slice(0, 200)}`);
  }
  const raw = await r.text();
  try {
    return (JSON.parse(raw).choices?.[0]?.message?.content || '').trim();
  } catch {
    // Some providers stream even when stream:false — fold the SSE deltas in.
    let out = '';
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const d = t.slice(5).trim();
      if (d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        out += j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || '';
      } catch {}
    }
    return out.trim();
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function streamAnswer({ question, tabIds, from, to }, res) {
  const { baseUrl, apiKey } = aiConfig();
  if (!apiKey && baseUrl.includes('api.openai.com')) {
    res.status(400).json({ error: 'No AI API key configured. Add one in Settings → AI.' });
    return;
  }
  const { messages, included, total } = buildPrompt(question, { tabIds, from, to });

  await assertAllowed(baseUrl);
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: authHeaders(), body: chatBody(messages, { stream: true }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    res.status(502).json({ error: `AI provider error (${upstream.status}): ${text.slice(0, 500)}` });
    return;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  // Tell the client how much of the matching journal actually fit in context,
  // so it can warn when older entries were dropped.
  res.setHeader('X-Dayleaf-Context', `${included}/${total}`);

  await pipeDeltas(upstream, res);
  res.end();
}

// ---------- Recap: map-reduce so a whole year fits regardless of context ----------

function gatherRange({ tabIds, from, to }) {
  let sql = `SELECT e.entry_date, e.content, e.mood, t.name AS tab_name
             FROM entries e JOIN tabs t ON t.id = e.tab_id WHERE 1=1`;
  const params = [];
  if (Array.isArray(tabIds) && tabIds.length > 0) {
    sql += ` AND e.tab_id IN (${tabIds.map(() => '?').join(',')})`;
    params.push(...tabIds.map(Number));
  }
  if (from) { sql += ' AND e.entry_date >= ?'; params.push(from); }
  if (to) { sql += ' AND e.entry_date <= ?'; params.push(to); }
  sql += ' ORDER BY e.entry_date ASC, e.created_at ASC LIMIT 5000';
  return db.prepare(sql).all(...params);
}

const LENSES = {
  recap: {
    label: 'recap',
    instr: 'Write a warm, encouraging recap: the main themes, highlights, growth and challenges, and how things felt overall.',
  },
  accomplishments: {
    label: 'list of accomplishments',
    instr: 'Produce a prioritized list of concrete accomplishments, each with specifics and any measurable outcomes or numbers.',
  },
  interview: {
    label: 'interview preparation',
    instr: 'Produce interview-ready material: 4–6 STAR stories (Situation, Task, Action, Result) drawn from real events, then a short list of demonstrated skills and measurable impact.',
  },
  mood: {
    label: 'wellbeing review',
    instr: 'Summarize mood and wellbeing trends, what lifted or drained energy, patterns worth noticing, and gentle supportive observations.',
  },
};

// Streams a recap. Progress lines first, then a \f separator, then the digest.
export async function streamRecap({ tabIds, from, to, lens = 'recap' }, res) {
  const { baseUrl, apiKey } = aiConfig();
  if (!apiKey && baseUrl.includes('api.openai.com')) {
    res.status(400).json({ error: 'No AI API key configured. Add one in Settings → AI.' });
    return;
  }
  const lensDef = LENSES[lens] || LENSES.recap;
  const entries = gatherRange({ tabIds, from, to });
  if (entries.length === 0) {
    res.status(400).json({ error: 'No entries in that period to recap yet.' });
    return;
  }
  await assertAllowed(baseUrl);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const fmt = (e) => `[${e.entry_date}]${e.mood ? ` (mood: ${e.mood})` : ''}\n${e.content}`;
  const totalChars = entries.reduce((n, e) => n + e.content.length, 0);

  const buckets = new Map();
  for (const e of entries) {
    const k = e.entry_date.slice(0, 7); // YYYY-MM
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }

  let source;
  if (totalChars <= MAX_CONTEXT_CHARS && buckets.size <= 2) {
    // Short period: the raw entries fit — no map phase needed.
    source = entries.map(fmt).join('\n\n');
  } else {
    // Map: summarize each month independently so any volume fits.
    const months = [...buckets.keys()].sort();
    res.write(`Reading ${entries.length} entries across ${months.length} months…\n`);
    const summaries = await mapLimit(months, 4, async (k) => {
      const label = new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      let text = buckets.get(k).map(fmt).join('\n\n');
      if (text.length > MAX_CONTEXT_CHARS) text = text.slice(0, MAX_CONTEXT_CHARS);
      const summary = await aiText([
        { role: 'system', content: `Summarize one month (${label}) of the user's journal. Compact and factual: what they did, accomplishments with any numbers/outcomes, recurring themes, notable events, and overall mood. ~150 words. Use ONLY these entries.` },
        { role: 'user', content: text },
      ], 400);
      res.write(`· ${label}\n`);
      return `${label}\n${summary}`;
    });
    source = summaries.join('\n\n');
  }

  res.write('\f'); // separator: everything after this is the digest

  const today = new Date().toISOString().slice(0, 10);
  const period = from ? `${from} to ${to || today}` : 'all time';
  const messages = [
    { role: 'system', content: `You are crafting a ${lensDef.label} from the user's private journal, covering ${period}. ${lensDef.instr} Base it ONLY on the material provided — never invent events. Be warm, specific, and well-structured using short plain-text section headings (no markdown symbols like # or *). Today is ${today}.` },
    { role: 'user', content: `Material:\n\n${source}` },
  ];
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', headers: authHeaders(), body: chatBody(messages, { stream: true }),
  });
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    res.write(`\n[AI error ${upstream.status}: ${t.slice(0, 200)}]`);
    res.end();
    return;
  }
  await pipeDeltas(upstream, res);
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
