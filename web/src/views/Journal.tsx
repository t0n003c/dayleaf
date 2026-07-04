import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useIsMobile } from '../hooks';
import type { Entry, FlashbackGroup, Stats, Tab } from '../types';
import Composer from '../components/Composer';
import { leafBurst, milestoneMoment } from '../components/celebrate';
import { MILESTONES } from '../components/StreakRing';
import CountUp from '../components/CountUp';
import EntryCard from '../components/EntryCard';
import StreakRing from '../components/StreakRing';
import TabIcon from '../components/TabIcon';

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
  searchSignal?: number;
  refreshSignal?: number;
  onBeginDrag?: (entry: Entry, x: number, y: number) => void;
  showToast: (msg: string) => void;
  username?: string;
}

export default function Journal({ tabs, activeTab, composeSignal, searchSignal, refreshSignal, onBeginDrag, showToast, username }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [flashbacks, setFlashbacks] = useState<FlashbackGroup[]>([]);
  const [loaded, setLoaded] = useState(false); // first /api/entries fetch resolved?
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
    setLoaded(true);
    api.get(`/api/stats?today=${today}`).then(setStats).catch(() => {});
  }, [activeTab, search, today]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (refreshSignal) load(); }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get(`/api/onthisday?today=${today}`).then(setFlashbacks).catch(() => {});
  }, [today]);

  useEffect(() => {
    if (composeSignal > 0) setComposerOpen(true);
  }, [composeSignal]);

  useEffect(() => {
    if (searchSignal && searchSignal > 0) setSearchOpen(true);
  }, [searchSignal]);

  // one-time celebration when a streak milestone is reached
  useEffect(() => {
    if (!stats) return;
    if (MILESTONES.includes(stats.streak) && localStorage.getItem('dayleaf-milestone') !== String(stats.streak)) {
      localStorage.setItem('dayleaf-milestone', String(stats.streak));
      milestoneMoment();
      showToast(`${stats.streak}-day streak! 🌿`);
    }
  }, [stats, showToast]);

  // drag the sheet handle down to dismiss the mobile composer
  useEffect(() => {
    if (!composerOpen || !isMobile) return;
    const sheet = document.querySelector('.composer-sheet') as HTMLElement | null;
    const overlay = document.querySelector('.sheet-overlay') as HTMLElement | null;
    const grip = sheet?.querySelector('.sheet-grip') as HTMLElement | null;
    if (!sheet || !grip) return;
    let sy = 0, dy = 0, raf = 0, active = false;
    const height = () => sheet.getBoundingClientRect().height || 300;
    const paint = () => {
      raf = 0;
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${Math.max(0, dy)}px)`;
      if (overlay) {
        overlay.style.transition = 'none';
        overlay.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / height()));
      }
    };
    const sched = () => { if (!raf) raf = requestAnimationFrame(paint); };
    const onStart = (e: TouchEvent) => { sy = e.touches[0].clientY; dy = 0; active = true; };
    const onMove = (e: TouchEvent) => { if (!active) return; dy = e.touches[0].clientY - sy; sched(); };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (dy > height() * 0.25) setComposerOpen(false);
      else {
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (overlay) { overlay.style.transition = ''; overlay.style.opacity = ''; }
      }
    };
    grip.addEventListener('touchstart', onStart, { passive: true });
    grip.addEventListener('touchmove', onMove, { passive: true });
    grip.addEventListener('touchend', onEnd, { passive: true });
    grip.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      grip.removeEventListener('touchstart', onStart);
      grip.removeEventListener('touchmove', onMove);
      grip.removeEventListener('touchend', onEnd);
      grip.removeEventListener('touchcancel', onEnd);
    };
  }, [composerOpen, isMobile]);

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
      onSaved={() => { load(); setComposerOpen(false); showToast('Saved 🍃'); leafBurst(); }}
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
                ? <><TabIcon emoji={activeTabObj.emoji} className="inline-tab-icon" /> {activeTabObj.name}</>
                : new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            {stats && stats.daysJournaled > 0 && (
              <span className="stat-pill">🍃 <CountUp value={stats.daysJournaled} /> {stats.daysJournaled === 1 ? 'day' : 'days'} journaled</span>
            )}
          </div>
        </div>
        {stats && stats.streak >= 1 && <StreakRing streak={stats.streak} />}
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
            <div className="sheet-grip"><div className="sheet-handle" /></div>
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
                  <span><TabIcon emoji={e.tab_emoji} className="inline-tab-icon" /> {e.tab_name}</span>
                  {e.mood && <span>{e.mood}</span>}
                </div>
                <div className="flash-content">{e.content}</div>
              </div>
            ))
          )}
        </section>
      )}

      {loaded && grouped.length === 0 && (
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
          {dayEntries.map((e, i) => (
            <EntryCard
              key={e.id}
              entry={e}
              tabs={tabs}
              showTab={activeTab === 'all'}
              onChanged={load}
              onBeginDrag={onBeginDrag}
              stagger={Math.min(i, 8)}
            />
          ))}
        </section>
      ))}
    </>
  );
}
