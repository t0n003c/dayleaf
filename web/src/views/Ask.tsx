import { useState } from 'react';
import { api } from '../api';
import type { Tab } from '../types';

interface QA {
  question: string;
  answer: string;
  done: boolean;
}

const RANGES = [
  { id: 'week', label: 'Last 7 days', days: 7 },
  { id: 'month', label: 'Last 30 days', days: 30 },
  { id: 'quarter', label: 'Last 3 months', days: 92 },
  { id: 'all', label: 'All time', days: 0 },
];

const SUGGESTIONS = [
  'What did I do last week?',
  'How have I been feeling lately?',
  'Summarize my month',
  'What did I say about my projects?',
];

export default function Ask({ tabs }: { tabs: Tab[] }) {
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<number[]>([]); // empty = all tabs
  const [range, setRange] = useState('month');
  const [history, setHistory] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function toggleTab(id: number) {
    setScope((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setError('');
    setBusy(true);
    setQuestion('');
    const idx = history.length;
    setHistory((h) => [...h, { question: text, answer: '', done: false }]);

    const days = RANGES.find((r) => r.id === range)?.days ?? 30;
    const from = days
      ? new Date(Date.now() - days * 86400_000).toLocaleDateString('sv')
      : undefined;

    try {
      await api.ask(
        { question: text, tabIds: scope.length ? scope : null, from },
        (chunk) =>
          setHistory((h) =>
            h.map((qa, i) => (i === idx ? { ...qa, answer: qa.answer + chunk } : qa))
          )
      );
    } catch (err: any) {
      setError(err.message);
      setHistory((h) => h.filter((_, i) => i !== idx));
    } finally {
      setBusy(false);
      setHistory((h) => h.map((qa, i) => (i === idx ? { ...qa, done: true } : qa)));
    }
  }

  return (
    <>
      <div className="card">
        <textarea
          className="composer"
          style={{ width: '100%', border: 'none', background: 'transparent', resize: 'none', outline: 'none', fontSize: 16, minHeight: 48 }}
          placeholder="Ask your journal anything…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
          }}
        />

        <div className="scope-row">
          <button className={`chip ${scope.length === 0 ? 'active' : ''}`} onClick={() => setScope([])}>
            🗂️ All tabs
          </button>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`chip ${scope.includes(t.id) ? 'active' : ''}`}
              style={{ ['--chip-color' as any]: t.color }}
              onClick={() => toggleTab(t.id)}
            >
              {t.emoji} {t.name}
            </button>
          ))}
        </div>

        <div className="scope-row">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={`chip ${range === r.id ? 'active' : ''}`}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn primary" onClick={() => ask()} disabled={busy || !question.trim()}>
          ✨ Ask
        </button>
      </div>

      {history.length === 0 && (
        <div className="scope-row" style={{ marginTop: 14 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      {[...history].reverse().map((qa, i) => (
        <div className="card qa-item" key={history.length - i}>
          <div className="qa-q">✦ {qa.question}</div>
          <div className={`qa-a ${qa.done ? '' : 'thinking'}`}>{qa.answer || (qa.done ? '' : ' ')}</div>
        </div>
      ))}
    </>
  );
}
