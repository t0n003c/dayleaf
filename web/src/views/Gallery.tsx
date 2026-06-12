import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { appConfirm } from '../components/dialog';
import type { GalleryItem } from '../types';

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function monthLabel(date: string): string {
  return new Date(`${date.slice(0, 7)}-15T12:00:00`).toLocaleDateString(undefined, {
    month: 'long', year: 'numeric',
  });
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export default function Gallery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null); // index into items
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const res = await api.get(`/api/attachments?offset=${itemsRef.current.length}&limit=60`);
      setTotal(res.total);
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...res.items.filter((i: GalleryItem) => !seen.has(i.id))];
      });
    } finally {
      loading.current = false;
    }
  }, []);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => { loadMore(); }, [loadMore]);

  // infinite scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && total !== null && itemsRef.current.length < total) loadMore();
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [total, loadMore]);

  const groups = useMemo(() => {
    const map = new Map<string, { index: number; item: GalleryItem }[]>();
    items.forEach((item, index) => {
      const key = item.entry_date.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ index, item });
    });
    return [...map.entries()];
  }, [items]);

  const cur = selected !== null ? items[selected] : null;

  const step = useCallback((dir: 1 | -1) => {
    setSelected((s) => {
      if (s === null) return s;
      const next = s + dir;
      return next >= 0 && next < itemsRef.current.length ? next : s;
    });
  }, []);

  // keyboard navigation in the viewer
  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, step]);

  async function deletePhoto() {
    if (!cur) return;
    const ok = await appConfirm({
      title: 'Delete this photo?',
      message: 'It will be removed from its journal entry too. This cannot be undone.',
      confirmLabel: 'Delete photo',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/attachments/${cur.id}`);
    setItems((prev) => prev.filter((i) => i.id !== cur.id));
    setTotal((t) => (t === null ? t : t - 1));
    setSelected((s) => {
      const remaining = itemsRef.current.length - 1;
      if (remaining <= 0 || s === null) return null;
      return Math.min(s, remaining - 1);
    });
  }

  return (
    <>
      <header className="greet">
        <div className="greet-text">
          <h1>Photos <span className="greet-emoji">🌿</span></h1>
          <div className="greet-sub">
            {total !== null && (
              <span>{total === 0 ? 'No photos yet' : `${total} ${total === 1 ? 'memory' : 'memories'} captured`}</span>
            )}
          </div>
        </div>
      </header>

      {total === 0 && (
        <div className="empty-state">
          <div className="big">🌿</div>
          No photos yet — attach one from the composer, or snap one with your phone camera.
        </div>
      )}

      {groups.map(([month, members]) => (
        <section key={month}>
          <h3 className="day-header">
            {monthLabel(members[0].item.entry_date)}
            <span className="count">{members.length} {members.length === 1 ? 'photo' : 'photos'}</span>
          </h3>
          <div className="gallery-grid">
            {members.map(({ index, item }) => (
              <button
                className="gallery-thumb"
                key={item.id}
                style={{ ['--stagger' as any]: index % 12 }}
                onClick={() => setSelected(index)}
              >
                <img src={`/api/files/${item.filename}?thumb=1`} alt="" loading="lazy" />
                <span className="thumb-emoji">{item.tab_emoji}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <div ref={sentinel} />

      {cur && (
        <div className="photo-viewer" onClick={() => setSelected(null)}>
          <div className="viewer-body" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-stage">
              <img key={cur.id} className="viewer-img" src={`/api/files/${cur.filename}`} alt="" />
              {selected! > 0 && (
                <button className="viewer-nav prev" aria-label="Previous photo" onClick={() => step(-1)}>‹</button>
              )}
              {selected! < items.length - 1 && (
                <button className="viewer-nav next" aria-label="Next photo" onClick={() => step(1)}>›</button>
              )}
              <button className="viewer-close" aria-label="Close" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="viewer-info card">
              <div className="viewer-meta-row">
                <span className="tab-pill" style={{ color: cur.tab_color }}>
                  {cur.tab_emoji} {cur.tab_name}
                </span>
                {cur.mood && <span className="mood">{cur.mood}</span>}
                <span className="viewer-count">{selected! + 1} / {items.length}</span>
              </div>
              <div className="viewer-date">{dayLabel(cur.entry_date)}</div>
              {cur.snippet && <p className="viewer-snippet">{cur.snippet}</p>}
              <div className="viewer-file hint">
                {fmtSize(cur.size)} · {cur.mime.replace('image/', '').toUpperCase()}
              </div>
              <div className="viewer-actions">
                <a className="btn small" href={`/api/files/${cur.filename}`} target="_blank" rel="noreferrer">
                  Open original
                </a>
                <button className="btn danger small" onClick={deletePhoto}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
