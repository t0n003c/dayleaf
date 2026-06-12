import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { Entry, Tab } from '../types';
import Composer from '../components/Composer';
import EntryCard from '../components/EntryCard';

function dayLabel(date: string): string {
  const today = new Date();
  const todayStr = today.toLocaleDateString('sv'); // YYYY-MM-DD in local time
  const yesterday = new Date(today.getTime() - 86400_000).toLocaleDateString('sv');
  if (date === todayStr) return 'Today';
  if (date === yesterday) return 'Yesterday';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
    year: date.slice(0, 4) !== todayStr.slice(0, 4) ? 'numeric' : undefined,
  });
}

interface Props {
  tabs: Tab[];
  composeSignal: number;
  showToast: (msg: string) => void;
}

export default function Journal({ tabs, composeSignal, showToast }: Props) {
  const [activeTab, setActiveTab] = useState<number | 'all'>(() => {
    const saved = localStorage.getItem('dayleaf-tab');
    return saved && saved !== 'all' ? Number(saved) : 'all';
  });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (activeTab !== 'all') params.set('tab', String(activeTab));
    if (search.trim()) params.set('q', search.trim());
    setEntries(await api.get(`/api/entries?${params}`));
  }, [activeTab, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { localStorage.setItem('dayleaf-tab', String(activeTab)); }, [activeTab]);

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      if (!map.has(e.entry_date)) map.set(e.entry_date, []);
      map.get(e.entry_date)!.push(e);
    }
    return [...map.entries()];
  }, [entries]);

  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (composeSignal > 0) {
      composerRef.current?.querySelector('textarea')?.focus();
      composerRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [composeSignal]);

  const composerTab = activeTab === 'all' ? tabs[0]?.id : activeTab;

  return (
    <>
      <div className="tab-row">
        <button
          className={`chip ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          🗂️ All
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`chip ${activeTab === t.id ? 'active' : ''}`}
            style={{ ['--chip-color' as any]: t.color }}
            onClick={() => setActiveTab(t.id)}
          >
            {t.emoji} {t.name}
          </button>
        ))}
        <button
          className={`chip ${searchOpen ? 'active' : ''}`}
          onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearch(''); }}
        >
          🔍
        </button>
      </div>

      {searchOpen && (
        <div className="search-row">
          <input
            className="input"
            placeholder="Search your journal…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {composerTab !== undefined && (
        <div ref={composerRef}>
          <Composer
            tabs={tabs}
            defaultTab={composerTab}
            onSaved={() => { load(); showToast('Saved 🍃'); }}
          />
        </div>
      )}

      {grouped.length === 0 && (
        <div className="empty-state">
          <div className="big">🍃</div>
          {search ? 'Nothing matches your search.' : 'No entries yet — jot down your first thought above.'}
        </div>
      )}

      {grouped.map(([date, dayEntries]) => (
        <section key={date}>
          <h3 className="day-header">
            {dayLabel(date)}
            <span className="count">{dayEntries.length} {dayEntries.length === 1 ? 'entry' : 'entries'}</span>
          </h3>
          {dayEntries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              tabs={tabs}
              showTab={activeTab === 'all'}
              onChanged={load}
            />
          ))}
        </section>
      ))}
    </>
  );
}
