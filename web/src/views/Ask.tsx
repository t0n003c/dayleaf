import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useIsMobile } from '../hooks';
import TabIcon, { tabIconText } from '../components/TabIcon';
import type { Tab } from '../types';

interface QA {
  question: string;
  answer: string;
  done: boolean;
  scopeLabel: string;
  rangeLabel: string;
  progress?: string; // recap map-phase status, shown until the digest streams
  note?: string;     // e.g. "answered from your N most recent entries"
}

const RANGES = [
  { id: 'week', label: 'Last 7 days', days: 7 },
  { id: 'month', label: 'Last 30 days', days: 30 },
  { id: 'quarter', label: 'Last 3 months', days: 92 },
  { id: 'year', label: 'Last year', days: 365 },
  { id: 'all', label: 'All time', days: 0 },
];

const LENSES = [
  { id: 'recap', label: 'Recap', emoji: '🍂' },
  { id: 'accomplishments', label: 'Accomplishments', emoji: '🏆' },
  { id: 'interview', label: 'Interview prep', emoji: '💼' },
  { id: 'mood', label: 'Wellbeing', emoji: '🌿' },
];

const SUGGESTIONS = [
  'What did I do last week?',
  'How have I been feeling lately?',
  'Summarize my month in a few lines',
  'What have I accomplished recently?',
];

/** A small anchored dropdown that closes on outside click or Escape. */
function Dropdown({
  icon,
  summary,
  children,
  open,
  onToggle,
}: {
  icon: string;
  summary: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onToggle]);

  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className={`select-pill ${open ? 'open' : ''}`} onClick={() => onToggle(!open)}>
        <span className="select-icon">{icon}</span>
        {summary}
        <svg className="chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="menu">{children}</div>}
    </div>
  );
}

export default function Ask({ tabs }: { tabs: Tab[] }) {
  const [mode, setMode] = useState<'ask' | 'recap'>('ask');
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<number[]>([]); // empty = all tabs
  const [range, setRange] = useState('month');
  const [lens, setLens] = useState('recap');
  const [openMenu, setOpenMenu] = useState<'tabs' | 'range' | null>(null);
  const [history, setHistory] = useState<QA[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isMobile = useIsMobile();

  const scopeLabel =
    scope.length === 0
      ? 'All tabs'
      : scope.length === 1
        ? `${tabIconText(tabs.find((t) => t.id === scope[0])?.emoji)} ${tabs.find((t) => t.id === scope[0])?.name ?? ''}`.trim()
        : `${scope.length} tabs`;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? '';

  function toggleTab(id: number) {
    setScope((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  function rangeFrom() {
    const days = RANGES.find((r) => r.id === range)?.days ?? 30;
    return days ? new Date(Date.now() - days * 86400_000).toLocaleDateString('sv') : undefined;
  }

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setError('');
    setBusy(true);
    setQuestion('');
    setOpenMenu(null);
    const idx = history.length;
    setHistory((h) => [...h, { question: text, answer: '', done: false, scopeLabel, rangeLabel }]);

    try {
      await api.ask(
        { question: text, tabIds: scope.length ? scope : null, from: rangeFrom() },
        (chunk) =>
          setHistory((h) => h.map((qa, i) => (i === idx ? { ...qa, answer: qa.answer + chunk } : qa))),
        (meta) => {
          if (meta.included < meta.total) {
            setHistory((h) =>
              h.map((qa, i) =>
                i === idx
                  ? { ...qa, note: `Based on your ${meta.included} most recent matching entries (of ${meta.total}). Narrow the date range, or use Recap for the whole period.` }
                  : qa
              )
            );
          }
        }
      );
    } catch (err: any) {
      setError(err.message);
      setHistory((h) => h.filter((_, i) => i !== idx));
    } finally {
      setBusy(false);
      setHistory((h) => h.map((qa, i) => (i === idx ? { ...qa, done: true } : qa)));
    }
  }

  async function runRecap() {
    if (busy) return;
    setError('');
    setBusy(true);
    setOpenMenu(null);
    const lensLabel = LENSES.find((l) => l.id === lens)?.label ?? 'Recap';
    const idx = history.length;
    setHistory((h) => [...h, { question: `${lensLabel} · ${rangeLabel}`, answer: '', progress: 'Starting…', done: false, scopeLabel, rangeLabel }]);

    try {
      await api.recap(
        { tabIds: scope.length ? scope : null, from: rangeFrom(), lens },
        (p) =>
          setHistory((h) =>
            h.map((qa, i) => (i === idx ? { ...qa, progress: (qa.progress === 'Starting…' ? '' : qa.progress || '') + p } : qa))
          ),
        (chunk) =>
          setHistory((h) =>
            h.map((qa, i) => (i === idx ? { ...qa, progress: '', answer: qa.answer + chunk } : qa))
          )
      );
    } catch (err: any) {
      setError(err.message);
      setHistory((h) => h.filter((_, i) => i !== idx));
    } finally {
      setBusy(false);
      setHistory((h) => h.map((qa, i) => (i === idx ? { ...qa, done: true, progress: '' } : qa)));
    }
  }

  const card = (
    <div className="card ask-card">
      <div className="ask-modes">
        <button type="button" className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')}>Ask</button>
        <button type="button" className={mode === 'recap' ? 'active' : ''} onClick={() => setMode('recap')}>Recap</button>
      </div>

      {mode === 'ask' ? (
        <div className="ask-input-wrap">
          <textarea
            className="ask-input"
            placeholder="Ask your journal anything…"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
            }}
          />
          <button type="button" className="send-btn" onClick={() => ask()} disabled={busy || !question.trim()} aria-label="Ask">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 8h10M9 4.5L13.5 8 9 11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ) : (
        <>
          <div className="recap-lenses">
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`chip ${lens === l.id ? 'active' : ''}`}
                onClick={() => setLens(l.id)}
              >
                {l.emoji} {l.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn primary recap-go" onClick={runRecap} disabled={busy}>
            ✨ Generate {LENSES.find((l) => l.id === lens)?.label.toLowerCase()}
          </button>
          <p className="hint" style={{ margin: '8px 2px 0' }}>
            Reads every entry in the period (month by month for long spans), so a full year is covered.
          </p>
        </>
      )}

      <div className="ask-controls">
        <span className="ask-controls-label">{mode === 'ask' ? 'Searching' : 'Covering'}</span>

        <Dropdown icon="🗂️" summary={scopeLabel} open={openMenu === 'tabs'} onToggle={(o) => setOpenMenu(o ? 'tabs' : null)}>
          <button
            type="button"
            className={`menu-item ${scope.length === 0 ? 'selected' : ''}`}
            onClick={() => { setScope([]); setOpenMenu(null); }}
          >
            <span className="menu-emoji">🗂️</span> All tabs
            {scope.length === 0 && <span className="check">✓</span>}
          </button>
          <div className="menu-divider" />
          {tabs.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`menu-item ${scope.includes(t.id) ? 'selected' : ''}`}
              onClick={() => toggleTab(t.id)}
            >
              <span className="menu-emoji"><TabIcon emoji={t.emoji} className="inline-tab-icon" /></span> {t.name}
              {scope.includes(t.id) && <span className="check">✓</span>}
            </button>
          ))}
          <div className="menu-hint">Pick several to combine tabs</div>
        </Dropdown>

        <Dropdown icon="🕐" summary={rangeLabel} open={openMenu === 'range'} onToggle={(o) => setOpenMenu(o ? 'range' : null)}>
          {RANGES.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`menu-item ${range === r.id ? 'selected' : ''}`}
              onClick={() => { setRange(r.id); setOpenMenu(null); }}
            >
              {r.label}
              {range === r.id && <span className="check">✓</span>}
            </button>
          ))}
        </Dropdown>
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  );

  return (
    <>
      {!isMobile && card}

      {history.length === 0 && mode === 'ask' && (
        <div className="suggestions">
          <p className="suggestions-title">Try asking</p>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="suggestion" onClick={() => ask(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      {[...history].reverse().map((qa, i) => (
        <article className="card qa-item" key={history.length - i}>
          <div className="qa-q">{qa.question}</div>
          <div className="qa-meta">{qa.scopeLabel} · {qa.rangeLabel}</div>
          {!qa.answer && !qa.done && qa.progress !== undefined ? (
            <div className="qa-a thinking" style={{ color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
              {qa.progress || ' '}
            </div>
          ) : (
            <div className={`qa-a ${qa.done ? '' : 'thinking'}`}>{qa.answer || (qa.done ? '' : ' ')}</div>
          )}
          {qa.note && <div className="qa-note">{qa.note}</div>}
        </article>
      ))}

      {isMobile && <div className="ask-dock">{card}</div>}
    </>
  );
}
