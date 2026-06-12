import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useIsMobile } from '../hooks';
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
  activeTab: number | 'all';
  composeSignal: number;
  showToast: (msg: string) => void;
  username?: string;
}

export default function Journal({ tabs, activeTab, composeSignal, showToast, username }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [flashbacks, setFlashbacks] = useState<FlashbackGroup[]>([]);
  const isMobile = useIsMobile();

  const today = new Date().toLocaleDateString('sv');
  const prompt = PROMPTS[new Date().getDate() % PROMPTS.length];
  const greet = greeting();
  const activeTabObj = activeTab === 'all' ? null : tabs.find((t) => t.id === activeTab);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (activeTab !== 'all') params.set('tab', String(activeTab));
    if (search.trim()) params.set('q', search.trim());
    setEntries(await api.get(`/api/entries?${params}`));
    api.get(`/api/stats?today=${today}`).then(setStats).catch(() => {});
  }, [activeTab, search, today]);

  useEffect(() => { load(); }, [load]);
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

  const quickJotPill = (
    <button className="compose-collapsed" onClick={() => setComposerOpen(true)}>
      <span className="leaf">🍃</span>
      <span className="prompt">{prompt}</span>
      <span className="plus">＋</span>
    </button>
  );

  const composer = composerTab !== undefined && (
    <Composer
      tabs={tabs}
      defaultTab={composerTab}
      placeholder={prompt}
      autoFocus
      onClose={() => setComposerOpen(false)}
      onSaved={() => { load(); setComposerOpen(false); showToast('Saved 🍃'); }}
    />
  );

  return (
    <>
      <header className="greet">
        <div className="greet-text">
          <h1>
            {greet.text}{username ? `, ${username}` : ''} <span className="greet-emoji">{greet.emoji}</span>
          </h1>
          <div className="greet-sub">
            <span>
              {activeTabObj
                ? `${activeTabObj.emoji} ${activeTabObj.name}`
                : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            {stats && stats.streak >= 2 && <span className="stat-pill">🔥 {stats.streak}-day streak</span>}
            {stats && stats.daysJournaled > 0 && (
              <span className="stat-pill">🍃 {stats.daysJournaled} {stats.daysJournaled === 1 ? 'day' : 'days'} journaled</span>
            )}
          </div>
        </div>
        <button
          className={`icon-btn search-btn ${searchOpen ? 'active' : ''}`}
          title="Search"
          onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearch(''); }}
        >
          🔍
        </button>
      </header>

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

      {/* Desktop: composer lives inline under the greeting.
          Mobile: the quick-jot pill docks at the bottom (thumb reach) and the
          composer opens as a bottom sheet. */}
      {composerTab !== undefined && !isMobile && (composerOpen ? composer : quickJotPill)}
      {composerTab !== undefined && isMobile && !composerOpen && (
        <div className="compose-dock">{quickJotPill}</div>
      )}
      {composerTab !== undefined && isMobile && composerOpen && (
        <>
          <div className="sheet-overlay" onClick={() => setComposerOpen(false)} />
          <div className="composer-sheet">
            <div className="sheet-handle" />
            {composer}
          </div>
        </>
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
          {search ? 'Nothing matches your search.' : 'No entries yet — jot down your first thought.'}
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
