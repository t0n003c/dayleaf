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
}

export default function Sidebar({
  tabs, activeTab, collapsed, mobileOpen,
  onSelect, onToggleCollapse, onClose, onNewTab, onEditTab,
}: Props) {
  const total = tabs.reduce((sum, t) => sum + (t.entry_count ?? 0), 0);

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
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`side-tab ${activeTab === t.id ? 'active' : ''}`}
              style={{ ['--chip-color' as any]: t.color }}
            >
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
