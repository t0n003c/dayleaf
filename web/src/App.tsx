import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Me, Tab } from './types';
import Setup from './views/Setup';
import Login from './views/Login';
import InstallBanner from './components/InstallBanner';
import Journal from './views/Journal';
import Ask from './views/Ask';
import Settings from './views/Settings';

type View = 'journal' | 'ask' | 'settings';

const NAV: { id: View; icon: string; label: string }[] = [
  { id: 'journal', icon: '🍃', label: 'Journal' },
  { id: 'ask', icon: '✨', label: 'Ask' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [view, setView] = useState<View>('journal');
  const [composeSignal, setComposeSignal] = useState(0);
  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  }, []);

  const refreshMe = useCallback(() => api.get('/api/me').then(setMe), []);
  const refreshTabs = useCallback(() => api.get('/api/tabs').then(setTabs), []);

  useEffect(() => { refreshMe(); }, [refreshMe]);

  useEffect(() => {
    if (me?.authed) refreshTabs();
  }, [me?.authed, refreshTabs]);

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

  if (!me) return null;
  if (me.needsSetup) return <><Setup onDone={refreshMe} /><InstallBanner /></>;
  if (!me.authed) return <><Login me={me} onDone={refreshMe} /><InstallBanner /></>;

  return (
    <div className="app">
      <header className="topbar">
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
              onClick={() => setView(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
      </header>

      {view === 'journal' && (
        <Journal tabs={tabs} composeSignal={composeSignal} showToast={showToast} username={me.username} />
      )}
      {view === 'ask' && <Ask tabs={tabs} />}
      {view === 'settings' && (
        <Settings me={me} tabs={tabs} refreshTabs={refreshTabs} refreshMe={refreshMe} showToast={showToast} />
      )}

      <nav className="bottom-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-btn ${view === n.id ? 'active' : ''}`}
            onClick={() => setView(n.id)}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>

      <InstallBanner />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
