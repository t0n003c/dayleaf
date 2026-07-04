import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import CountUp from '../components/CountUp';
import { appConfirm } from '../components/dialog';
import TabIcon from '../components/TabIcon';
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
  const [slideDir, setSlideDir] = useState<0 | 1 | -1>(0); // viewer entrance direction
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<number | null>(null);

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
  selRef.current = selected;

  const step = useCallback((dir: 1 | -1) => {
    setSlideDir(dir);
    setSelected((s) => {
      if (s === null) return s;
      const next = s + dir;
      return next >= 0 && next < itemsRef.current.length ? next : s;
    });
  }, []);

  // Touch gestures in the viewer: swipe to flip (finger-following), swipe
  // down to close, pinch to zoom, pan while zoomed, double-tap to toggle zoom.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || selected === null) return;
    let mode: 'idle' | 'swipe' | 'pan' | 'pinch' = 'idle';
    let sx = 0, sy = 0, dx = 0, dy = 0, raf = 0;
    let zoom = 1, panX = 0, panY = 0, startZoom = 1, startDist = 0, sPanX = 0, sPanY = 0, lastTap = 0;
    const img = () => stage.querySelector('img') as HTMLElement | null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const paint = () => {
      raf = 0;
      const el = img();
      if (!el) return;
      el.style.transition = 'none';
      if (zoom > 1) {
        el.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
        el.style.opacity = '';
      } else {
        el.style.transform = `translate(${dx}px, ${Math.max(0, dy)}px)`;
        el.style.opacity = String(1 - Math.min(0.55, (Math.abs(dx) + Math.max(0, dy)) / 500));
      }
    };
    const sched = () => { if (!raf) raf = requestAnimationFrame(paint); };
    const settleBack = () => {
      const el = img();
      if (!el) return;
      el.style.transition = 'transform 0.26s cubic-bezier(0.3, 0.8, 0.3, 1), opacity 0.26s ease';
      el.style.transform = zoom > 1 ? `translate(${panX}px, ${panY}px) scale(${zoom})` : '';
      el.style.opacity = '';
    };
    const onStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement).closest('button')) { mode = 'idle'; return; }
      if (e.touches.length === 2) {
        mode = 'pinch';
        startDist = dist(e.touches);
        startZoom = zoom;
        return;
      }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; dx = 0; dy = 0;
      const now = Date.now();
      if (now - lastTap < 300) {
        zoom = zoom > 1 ? 1 : 2.2;
        panX = panY = 0;
        settleBack();
        lastTap = 0;
        mode = 'idle';
        return;
      }
      lastTap = now;
      mode = zoom > 1 ? 'pan' : 'swipe';
      sPanX = panX; sPanY = panY;
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'pinch' && e.touches.length === 2) {
        zoom = Math.min(4, Math.max(1, startZoom * (dist(e.touches) / startDist)));
        if (zoom === 1) { panX = panY = 0; }
        sched();
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (mode === 'pan') {
        const el = img();
        const limX = el ? ((zoom - 1) * el.offsetWidth) / 2 : 200;
        const limY = el ? ((zoom - 1) * el.offsetHeight) / 2 : 200;
        panX = Math.min(limX, Math.max(-limX, sPanX + (t.clientX - sx)));
        panY = Math.min(limY, Math.max(-limY, sPanY + (t.clientY - sy)));
        sched();
      } else if (mode === 'swipe') {
        dx = t.clientX - sx;
        dy = t.clientY - sy;
        sched();
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        if (mode === 'pinch') {
          mode = zoom > 1 ? 'pan' : 'idle';
          const t = e.touches[0];
          sx = t.clientX; sy = t.clientY; sPanX = panX; sPanY = panY;
        }
        return;
      }
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (mode === 'pinch') {
        if (zoom < 1.05) { zoom = 1; panX = panY = 0; }
        settleBack();
      } else if (mode === 'swipe') {
        const s = selRef.current ?? 0;
        if (dx < -70 && s < itemsRef.current.length - 1) step(1);
        else if (dx > 70 && s > 0) step(-1);
        else if (dy > 90 && Math.abs(dx) < 60) setSelected(null);
        else settleBack();
      } else {
        settleBack();
      }
      mode = 'idle';
    };
    stage.addEventListener('touchstart', onStart, { passive: true });
    stage.addEventListener('touchmove', onMove, { passive: true });
    stage.addEventListener('touchend', onEnd, { passive: true });
    stage.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      stage.removeEventListener('touchstart', onStart);
      stage.removeEventListener('touchmove', onMove);
      stage.removeEventListener('touchend', onEnd);
      stage.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id]);

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
              <span>
                {total === 0 ? 'No photos yet' : <><CountUp value={total} /> {total === 1 ? 'memory' : 'memories'} captured</>}
              </span>
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
                onClick={() => { setSlideDir(0); setSelected(index); }}
              >
                <img src={`/api/files/${item.filename}?thumb=1`} alt="" loading="lazy" />
                <span className="thumb-emoji"><TabIcon emoji={item.tab_emoji} className="inline-tab-icon" /></span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <div ref={sentinel} />

      {cur && (
        <div className="photo-viewer" onClick={() => setSelected(null)}>
          <div className="viewer-body" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-stage" ref={stageRef}>
              <img
                key={cur.id}
                className={`viewer-img ${slideDir === 1 ? 'slide-next' : slideDir === -1 ? 'slide-prev' : ''}`}
                src={`/api/files/${cur.filename}`}
                alt=""
              />
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
                  <TabIcon emoji={cur.tab_emoji} className="inline-tab-icon" /> {cur.tab_name}
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
