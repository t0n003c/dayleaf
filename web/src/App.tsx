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
  const [toast, setToast] = useState('');
  const sidebarOpenRef = useRef(false);
  sidebarOpenRef.current = sidebarOpen;

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

  // Edge-swipe gestures for the mobile drawer: swipe right from the left
  // screen edge to open; swipe left anywhere (while open) to close.
  useEffect(() => {
    let startX = 0, startY = 0, fromEdge = false, tracking = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      fromEdge = t.clientX < 28;
      tracking = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > 70) { tracking = false; return; } // it's a scroll
      if (!sidebarOpenRef.current && fromEdge && dx > 60) {
        setSidebarOpen(true);
        tracking = false;
      } else if (sidebarOpenRef.current && dx < -60) {
        setSidebarOpen(false);
        tracking = false;
      }
    };
    const onEnd = () => { tracking = false; };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
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

  if (!me) return null;
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

          {view === 'journal' && (
            <Journal
              tabs={tabs}
              activeTab={activeTab}
              composeSignal={composeSignal}
              showToast={showToast}
              username={me.username}
            />
          )}
          {view === 'ask' && <Ask tabs={tabs} />}
          {view === 'gallery' && <Gallery />}
          {view === 'settings' && (
            <Settings me={me} tabs={tabs} refreshTabs={refreshTabs} refreshMe={refreshMe} showToast={showToast} />
          )}

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
