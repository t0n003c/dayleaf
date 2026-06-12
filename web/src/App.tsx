import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Me, Tab } from './types';
import Setup from './views/Setup';
import Login from './views/Login';
import Journal from './views/Journal';
import Ask from './views/Ask';
import Gallery from './views/Gallery';
import Settings from './views/Settings';
import InstallBanner from './components/InstallBanner';
import Sidebar from './components/Sidebar';
import TabEditor from './components/TabEditor';
import { appAlert, appConfirm, DialogHost } from './components/dialog';

type View = 'journal' | 'ask' | 'gallery' | 'settings';

const NAV: { id: View; icon: string; label: string }[] = [
  { id: 'journal', icon: '🍃', label: 'Journal' },
  { id: 'ask', icon: '✨', label: 'Ask' },
  { id: 'gallery', icon: '🖼️', label: 'Photos' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [view, setView] = useState<View>('journal');
  const [activeTab, setActiveTab] = useState<number | 'all'>(() => {
    const saved = localStorage.getItem('dayleaf-tab');
    return saved && saved !== 'all' ? Number(saved) : 'all';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('dayleaf-sidebar') === 'collapsed'
  );
  const [editingTab, setEditingTab] = useState<Tab | 'new' | null>(null);
  const [composeSignal, setComposeSignal] = useState(0);
  const [searchSignal, setSearchSignal] = useState(0);
  const [toast, setToast] = useState('');
  const sidebarOpenRef = useRef(false);
  sidebarOpenRef.current = sidebarOpen;
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  }, []);

  const refreshMe = useCallback(() => api.get('/api/me').then(setMe), []);
  const refreshTabs = useCallback(() => api.get('/api/tabs').then(setTabs), []);

  const reorderTabs = useCallback((ids: number[]) => {
    // optimistic: reflect the new order immediately, reconcile on failure
    setTabs((prev) =>
      ids
        .map((id) => prev.find((t) => t.id === id))
        .filter((t): t is Tab => !!t)
        .map((t, i) => ({ ...t, position: i }))
    );
    api.put('/api/tabs/reorder', { ids }).catch(() => refreshTabs());
  }, [refreshTabs]);

  const deleteTab = useCallback(async (t: Tab) => {
    const ok = await appConfirm({
      title: `Delete “${t.name}”?`,
      message: 'This journal and ALL of its entries will be deleted forever.',
      confirmLabel: 'Delete journal',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/tabs/${t.id}`);
      setActiveTab((cur) => (cur === t.id ? 'all' : cur));
      refreshTabs();
      showToast('Journal deleted');
    } catch (err: any) {
      appAlert('Could not delete', err.message);
    }
  }, [refreshTabs, showToast]);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  // Ambient time-of-day tint (peach dawn / leaf day / lavender dusk / moon night)
  useEffect(() => {
    const apply = () => {
      const h = new Date().getHours();
      document.documentElement.dataset.daypart =
        h < 5 ? 'night' : h < 11 ? 'morning' : h < 17 ? 'day' : h < 21 ? 'evening' : 'night';
    };
    apply();
    const t = window.setInterval(apply, 10 * 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Desktop keyboard shortcuts: N new entry, / search, G photos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!meRef.current?.authed) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setView('journal'); setComposeSignal((n) => n + 1); }
      if (e.key === '/') { e.preventDefault(); setView('journal'); setSearchSignal((n) => n + 1); }
      if (e.key === 'g' || e.key === 'G') setView('gallery');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { if (me?.authed) refreshTabs(); }, [me?.authed, refreshTabs]);
  useEffect(() => { localStorage.setItem('dayleaf-tab', String(activeTab)); }, [activeTab]);
  useEffect(() => {
    localStorage.setItem('dayleaf-sidebar', sidebarCollapsed ? 'collapsed' : 'open');
  }, [sidebarCollapsed]);

  // If the active tab was deleted, fall back to All.
  useEffect(() => {
    if (activeTab !== 'all' && tabs.length > 0 && !tabs.some((t) => t.id === activeTab)) {
      setActiveTab('all');
    }
  }, [tabs, activeTab]);

  // Interactive edge-swipe for the mobile drawer: the sidebar follows the
  // finger in real time (rAF-throttled style writes), then springs to its
  // settled state on release. Vertical movement hands the gesture back to
  // native scrolling.
  useEffect(() => {
    let startX = 0, startY = 0, dx = 0, width = 300, raf = 0;
    let mode: 'idle' | 'maybe' | 'drag' = 'idle';
    let openAtStart = false;
    const sidebar = () => document.querySelector('.sidebar') as HTMLElement | null;
    const overlay = () => document.querySelector('.sidebar-overlay') as HTMLElement | null;

    const paint = () => {
      raf = 0;
      const el = sidebar();
      if (!el) return;
      const x = openAtStart
        ? Math.min(0, Math.max(-width, dx))          // dragging closed: 0 -> -width
        : Math.min(0, Math.max(-width, dx - width)); // dragging open: -width -> 0
      el.style.transition = 'none';
      el.style.transform = `translateX(${x}px)`;
      const ov = overlay();
      if (ov) {
        ov.style.transition = 'none';
        ov.style.opacity = String(Math.max(0, 1 + x / width));
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

    const settle = (commit: boolean) => {
      const el = sidebar();
      const targetOpen = commit ? !openAtStart : openAtStart;
      if (targetOpen !== sidebarOpenRef.current) setSidebarOpen(targetOpen);
      // restore the CSS transition, then drop inline styles next frame so the
      // drawer animates from wherever the finger left it to its class state
      requestAnimationFrame(() => {
        if (el) { el.style.transition = ''; el.style.transform = ''; }
        const ov = overlay();
        if (ov) { ov.style.transition = ''; ov.style.opacity = ''; }
      });
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      openAtStart = sidebarOpenRef.current;
      if (!openAtStart && t.clientX >= 28) { mode = 'idle'; return; } // open only from the edge
      mode = 'maybe';
      const el = sidebar();
      width = el ? el.getBoundingClientRect().width : 300;
    };
    const onMove = (e: TouchEvent) => {
      if (mode === 'idle') return;
      const t = e.touches[0];
      const mx = t.clientX - startX;
      const my = t.clientY - startY;
      if (mode === 'maybe') {
        if (Math.abs(my) > 14 && Math.abs(my) > Math.abs(mx)) { mode = 'idle'; return; }
        if (Math.abs(mx) <= 12) return;
        if (!openAtStart && mx < 0) { mode = 'idle'; return; }
        mode = 'drag';
      }
      dx = mx;
      schedule();
    };
    const onEnd = () => {
      if (mode !== 'drag') { mode = 'idle'; return; }
      mode = 'idle';
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const commit = openAtStart ? dx < -width * 0.32 : dx > width * 0.38;
      settle(commit);
      dx = 0;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // PWA shortcut deep links: /?action=new focuses the composer, /?action=ask opens Ask AI.
  useEffect(() => {
    if (!me?.authed) return;
    const action = new URLSearchParams(location.search).get('action');
    if (action === 'ask') setView('ask');
    if (action === 'new') {
      setView('journal');
      setComposeSignal((n) => n + 1);
    }
    if (action) history.replaceState(null, '', '/');
  }, [me?.authed]);

  function go(v: View) {
    setView(v);
    setSidebarOpen(false);
  }

  function selectTab(id: number | 'all') {
    setActiveTab(id);
    go('journal');
  }

  if (!me) {
    return (
      <div className="boot-splash" aria-label="Loading Dayleaf">
        <img src="/icons/icon.svg" alt="" />
      </div>
    );
  }
  if (me.needsSetup) return <><Setup onDone={refreshMe} /><InstallBanner /></>;
  if (!me.authed) return <><Login me={me} onDone={refreshMe} /><InstallBanner /></>;

  return (
    <div className="shell">
      <Sidebar
        tabs={tabs}
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        mobileOpen={sidebarOpen}
        onSelect={selectTab}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onClose={() => setSidebarOpen(false)}
        onNewTab={() => { setEditingTab('new'); setSidebarOpen(false); }}
        onEditTab={(t) => { setEditingTab(t); setSidebarOpen(false); }}
        onDeleteTab={deleteTab}
        onReorder={reorderTabs}
      />

      <div className="main">
        <div className={`app view-${view}`}>
          <header className="topbar">
            <button className="icon-btn menu-btn" aria-label="Open journals" onClick={() => setSidebarOpen(true)}>
              ☰
            </button>
            <div className="logo">
              <img src="/icons/icon.svg" alt="" />
              Dayleaf
            </div>
            <div className="spacer" />
            <nav className="desktop-nav">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  className={`nav-btn ${view === n.id ? 'active' : ''}`}
                  onClick={() => go(n.id)}
                >
                  <span className="nav-icon">{n.icon}</span>
                  {n.label}
                </button>
              ))}
            </nav>
          </header>

          <div className="view-wrap" key={view}>
            {view === 'journal' && (
              <Journal
                tabs={tabs}
                activeTab={activeTab}
                composeSignal={composeSignal}
                searchSignal={searchSignal}
                showToast={showToast}
                username={me.username}
              />
            )}
            {view === 'ask' && <Ask tabs={tabs} />}
            {view === 'gallery' && <Gallery />}
            {view === 'settings' && (
              <Settings me={me} tabs={tabs} refreshTabs={refreshTabs} refreshMe={refreshMe} showToast={showToast} />
            )}
          </div>

          <nav className="bottom-nav">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`nav-btn ${view === n.id ? 'active' : ''}`}
                onClick={() => go(n.id)}
              >
                <span className="nav-icon">{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>

          {toast && <div className="toast">{toast}</div>}
        </div>
      </div>

      {editingTab && (
        <TabEditor
          tab={editingTab === 'new' ? null : editingTab}
          onClose={() => setEditingTab(null)}
          onSaved={() => { setEditingTab(null); refreshTabs(); }}
        />
      )}
      <InstallBanner />
      <DialogHost />
    </div>
  );
}
