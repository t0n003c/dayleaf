import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Entry, FlashbackGroup, Stats, Tab } from '../types';
import Composer from '../components/Composer';
import EntryCard from '../components/EntryCard';

const PROMPTS = [
  'What happened today?',
  'What made you smile today?',
  'Capture a little moment from today…',
  'What are you grateful for today?',
  'Anything on your mind?',
  'What do you want to remember about today?',
  'How did today really go?',
];

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

function greeting(): { text: string; emoji: string } {
  const h = new Date().getHours();
  if (h < 5) return { text: 'Up late', emoji: '🌙' };
  if (h < 12) return { text: 'Good morning', emoji: '🌅' };
  if (h < 18) return { text: 'Good afternoon', emoji: '☀️' };
  return { text: 'Good evening', emoji: '🌙' };
}

interface Props {
  tabs: Tab[];
  composeSignal: number;
  showToast: (msg: string) => void;
  username?: string;
}

export default function Journal({ tabs, composeSignal, showToast, username }: Props) {
  const [activeTab, setActiveTab] = useState<number | 'all'>(() => {
    const saved = localStorage.getItem('dayleaf-tab');
    return saved && saved !== 'all' ? Number(saved) : 'all';
  });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [flashbacks, setFlashbacks] = useState<FlashbackGroup[]>([]);

  const today = new Date().toLocaleDateString('sv');
  const prompt = PROMPTS[new Date().getDate() % PROMPTS.length];
  const greet = greeting();

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (activeTab !== 'all') params.set('tab', String(activeTab));
    if (search.trim()) params.set('q', search.trim());
    setEntries(await api.get(`/api/entries?${params}`));
    api.get(`/api/stats?today=${today}`).then(setStats).catch(() => {});
  }, [activeTab, search, today]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { localStorage.setItem('dayleaf-tab', String(activeTab)); }, [activeTab]);
  useEffect(() => {
    api.get(`/api/onthisday?today=${today}`).then(setFlashbacks).catch(() => {});
  }, [today]);

  useEffect(() => {
    if (composeSignal > 0) setComposerOpen(true);
  }, [composeSignal]);

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      if (!map.has(e.entry_date)) map.set(e.entry_date, []);
      map.get(e.entry_date)!.push(e);
    }
    return [...map.entries()];
  }, [entries]);

  const composerTab = activeTab === 'all' ? tabs[0]?.id : activeTab;

  return (
    <>
      <header className="greet">
        <h1>
          {greet.text}{username ? `, ${username}` : ''} <span className="greet-emoji">{greet.emoji}</span>
        </h1>
        <div className="greet-sub">
          <span>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
          {stats && stats.streak >= 2 && <span className="stat-pill">🔥 {stats.streak}-day streak</span>}
          {stats && stats.daysJournaled > 0 && (
            <span className="stat-pill">🍃 {stats.daysJournaled} {stats.daysJournaled === 1 ? 'day' : 'days'} journaled</span>
          )}
        </div>
      </header>

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
        composerOpen ? (
          <Composer
            tabs={tabs}
            defaultTab={composerTab}
            placeholder={prompt}
            autoFocus
            onClose={() => setComposerOpen(false)}
            onSaved={() => { load(); setComposerOpen(false); showToast('Saved 🍃'); }}
          />
        ) : (
          <button className="compose-collapsed" onClick={() => setComposerOpen(true)}>
            <span className="leaf">🍃</span>
            <span className="prompt">{prompt}</span>
            <span className="plus">＋</span>
          </button>
        )
      )}

      {!search && flashbacks.length > 0 && (
        <section className="card flashback">
          <div className="flashback-head">🍂 On this day</div>
          {flashbacks.map((g) =>
            g.entries.map((e) => (
              <div className="flashback-item" key={e.id}>
                <div className="flash-meta">
                  <span className="flash-label">{g.label}</span>
                  <span>{e.tab_emoji} {e.tab_name}</span>
                  {e.mood && <span>{e.mood}</span>}
                </div>
                <div className="flash-content">{e.content}</div>
              </div>
            ))
          )}
        </section>
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
