import { useEffect, useRef, useState } from 'react';
import type { Tab } from '../types';
import TabIcon from './TabIcon';

interface Props {
  tabs: Tab[];
  value: number;
  onChange: (id: number) => void;
}

/** Image-aware replacement for native select controls.
 * Native <option> elements cannot render Thiings PNG icons, which made the
 * mobile composer and entry editor show only the fallback `◉` marker.
 */
export default function TabPicker({ tabs, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = tabs.find((tab) => tab.id === value) ?? tabs[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!current) return null;

  return (
    <div className={`tab-picker ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button"
        className="date-input tab-select tab-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <TabIcon emoji={current.emoji} className="inline-tab-icon" />
        <span className="tab-picker-name">{current.name}</span>
        <svg className="tab-picker-chevron" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="tab-picker-menu" role="listbox" aria-label="Choose journal">
          {tabs.map((tab) => (
            <button
              type="button"
              role="option"
              aria-selected={tab.id === current.id}
              className={`tab-picker-option ${tab.id === current.id ? 'selected' : ''}`}
              key={tab.id}
              onClick={() => { onChange(tab.id); setOpen(false); }}
            >
              <TabIcon emoji={tab.emoji} className="inline-tab-icon" />
              <span>{tab.name}</span>
              {tab.id === current.id && <span className="tab-picker-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
