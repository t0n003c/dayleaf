import { useEffect, useRef, useState } from 'react';
import type { Tab } from '../types';

interface Props {
  tabs: Tab[];
  activeTab: number | 'all';
  collapsed: boolean;   // desktop icon-rail mode
  mobileOpen: boolean;  // mobile drawer
  onSelect: (id: number | 'all') => void;
  onToggleCollapse: () => void;
  onClose: () => void;
  onNewTab: () => void;
  onEditTab: (t: Tab) => void;
  onReorder: (ids: number[]) => void;
}

export default function Sidebar({
  tabs, activeTab, collapsed, mobileOpen,
  onSelect, onToggleCollapse, onClose, onNewTab, onEditTab, onReorder,
}: Props) {
  const total = tabs.reduce((sum, t) => sum + (t.entry_count ?? 0), 0);

  // Drag-to-reorder via pointer events (works for mouse AND touch). The
  // dragged row follows the pointer; crossing 60% of a row height swaps
  // neighbours in the local order, committed to the server on release.
  const [order, setOrder] = useState<number[]>(() => tabs.map((t) => t.id));
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; index: number; rowH: number } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const dragIdRef = useRef(dragId);
  dragIdRef.current = dragId;

  useEffect(() => {
    if (dragIdRef.current === null) setOrder(tabs.map((t) => t.id));
  }, [tabs]);

  const ordered = order
    .map((id) => tabs.find((t) => t.id === id))
    .filter(Boolean) as Tab[];

  function startDrag(e: React.PointerEvent, tab: Tab) {
    e.preventDefault();
    const row = (e.currentTarget as HTMLElement).closest('.side-tab') as HTMLElement | null;
    drag.current = {
      startY: e.clientY,
      index: orderRef.current.indexOf(tab.id),
      rowH: (row?.offsetHeight ?? 40) + 2,
    };
    setDragId(tab.id);
    setDragY(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function moveDrag(e: React.PointerEvent) {
    if (dragIdRef.current === null || !drag.current) return;
    const d = drag.current;
    let dy = e.clientY - d.startY;
    const cur = orderRef.current;
    if (dy > d.rowH * 0.6 && d.index < cur.length - 1) {
      const next = [...cur];
      [next[d.index], next[d.index + 1]] = [next[d.index + 1], next[d.index]];
      setOrder(next);
      d.index += 1;
      d.startY += d.rowH;
      dy -= d.rowH;
    } else if (dy < -d.rowH * 0.6 && d.index > 0) {
      const next = [...cur];
      [next[d.index], next[d.index - 1]] = [next[d.index - 1], next[d.index]];
      setOrder(next);
      d.index -= 1;
      d.startY -= d.rowH;
      dy += d.rowH;
    }
    setDragY(dy);
  }

  function endDrag() {
    if (dragIdRef.current === null) return;
    setDragId(null);
    setDragY(0);
    drag.current = null;
    onReorder(orderRef.current);
  }

  return (
    <>
      {mobileOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <img src="/icons/icon.svg" alt="" />
          <span className="sidebar-title">Dayleaf</span>
          <button
            className="collapse-btn"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleCollapse}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {collapsed ? (
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </div>

        <div className="sidebar-label">Journals</div>

        <nav className="sidebar-tabs">
          <div className={`side-tab ${activeTab === 'all' ? 'active' : ''}`}>
            <button className="side-main" onClick={() => onSelect('all')} title="All journals">
              <span className="side-emoji">🗂️</span>
              <span className="side-name">All journals</span>
              <span className="side-count">{total}</span>
            </button>
          </div>
          {ordered.map((t) => (
            <div
              key={t.id}
              className={`side-tab ${activeTab === t.id ? 'active' : ''} ${dragId === t.id ? 'dragging' : ''}`}
              style={{
                ['--chip-color' as any]: t.color,
                ...(dragId === t.id ? { transform: `translateY(${dragY}px)` } : {}),
              }}
            >
              <button
                className="side-drag"
                title="Drag to reorder"
                aria-label={`Reorder ${t.name}`}
                onPointerDown={(e) => startDrag(e, t)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                ⠿
              </button>
              <button className="side-main" onClick={() => onSelect(t.id)} title={t.name}>
                <span className="side-emoji">{t.emoji}</span>
                <span className="side-name">{t.name}</span>
                <span className="side-count">{t.entry_count ?? 0}</span>
              </button>
              <button className="side-edit" title={`Edit ${t.name}`} onClick={() => onEditTab(t)}>
                ✎
              </button>
            </div>
          ))}
        </nav>

        <button className="sidebar-new" onClick={onNewTab} title="New journal">
          <span className="side-emoji">＋</span>
          <span className="side-name">New journal</span>
        </button>
      </aside>
    </>
  );
}
