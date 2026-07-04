import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  onPick: (name: string) => void;
}

export default function EmojiInsertPicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ name: string; url: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  async function load(nextOffset = 0) {
    const params = new URLSearchParams({ limit: '72', offset: String(nextOffset) });
    if (q.trim()) params.set('q', q.trim());
    const res = await api.get(`/api/emojis?${params}`);
    setTotal(res.total);
    setOffset(nextOffset);
    setItems((prev) => (nextOffset === 0 ? res.items : [...prev, ...res.items]));
  }

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => load(0).catch((err) => setError(err.message)), 180);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(name: string) {
    onPick(name);
    setOpen(false);
  }

  return (
    <div className="emoji-insert" ref={ref}>
      <button className="icon-btn" title="Insert imported icon" onClick={() => setOpen(!open)}>
        ✨
      </button>
      {open && (
        <div className="emoji-insert-popover">
          <input
            className="input"
            value={q}
            placeholder="Search imported icons..."
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          <div className="custom-emoji-grid compact">
            {items.map((item) => (
              <button key={item.name} title={item.name} onClick={() => pick(item.name)}>
                <img src={item.url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          {items.length === 0 && !error && (
            <p className="hint" style={{ margin: '8px 0 0' }}>
              No imported icons yet.
            </p>
          )}
          {items.length < total && (
            <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => load(offset + 72)}>
              Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
