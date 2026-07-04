import { useEffect, useState } from 'react';
import { api } from '../api';
import { appConfirm } from './dialog';
import type { Tab } from '../types';
import TabIcon, { customEmojiName, isCustomEmoji } from './TabIcon';

const EMOJIS = ['🏠', '💼', '❤️', '🏃', '🍳', '✈️', '📚', '🎮', '🌱', '🧠', '💰', '🐾', '🎨', '🛠️', '🩺', '📓'];
const COLORS = ['#5b8c5a', '#4a6fa5', '#b5654a', '#8a5aa5', '#a59a4a', '#4aa59a', '#a54a6f', '#6b7361'];

interface Props {
  tab: Tab | null; // null = creating
  onClose: () => void;
  onSaved: () => void;
}

export default function TabEditor({ tab, onClose, onSaved }: Props) {
  const [name, setName] = useState(tab?.name ?? '');
  const [emoji, setEmoji] = useState(tab?.emoji ?? '📓');
  const [color, setColor] = useState(tab?.color ?? COLORS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [customOpen, setCustomOpen] = useState(isCustomEmoji(tab?.emoji));
  const [emojiSearch, setEmojiSearch] = useState('');
  const [emojiOffset, setEmojiOffset] = useState(0);
  const [emojiTotal, setEmojiTotal] = useState(0);
  const [emojiItems, setEmojiItems] = useState<{ name: string; url: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  async function loadEmojis(offset = 0) {
    const params = new URLSearchParams({ limit: '72', offset: String(offset) });
    if (emojiSearch.trim()) params.set('q', emojiSearch.trim());
    const res = await api.get(`/api/emojis?${params}`);
    setEmojiTotal(res.total);
    setEmojiOffset(offset);
    setEmojiItems(offset === 0 ? res.items : [...emojiItems, ...res.items]);
  }

  useEffect(() => {
    if (!customOpen) return;
    const t = window.setTimeout(() => { loadEmojis(0).catch((err) => setError(err.message)); }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customOpen, emojiSearch]);

  async function importFromThiings() {
    setImporting(true);
    setImportMsg('Importing from /data/Thiings…');
    setError('');
    try {
      const r = await api.post('/api/emojis/import', { path: 'Thiings' });
      setImportMsg(`Imported ${r.imported} icon${r.imported === 1 ? '' : 's'} from ${r.zips.length} zip file${r.zips.length === 1 ? '' : 's'}.`);
      setCustomOpen(true);
      await loadEmojis(0);
    } catch (err: any) {
      setImportMsg('');
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (tab) await api.put(`/api/tabs/${tab.id}`, { name, emoji, color });
      else await api.post('/api/tabs', { name, emoji, color });
      onSaved();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!tab) return;
    const ok = await appConfirm({
      title: `Delete “${tab.name}”?`,
      message: 'This journal and ALL of its entries will be deleted forever.',
      confirmLabel: 'Delete journal',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/tabs/${tab.id}`);
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{tab ? 'Edit tab' : 'New tab'}</h3>
        <label className="field">
          Name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fitness, Kids, Garden…" autoFocus />
        </label>

        <div className="hint">Icon</div>
        <div className="emoji-grid">
          {EMOJIS.map((e) => (
            <button key={e} className={emoji === e ? 'active' : ''} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>

        <div className="custom-emoji-head">
          <button className="btn small" onClick={() => setCustomOpen(!customOpen)}>
            Imported icons
          </button>
          <button className="btn ghost small" onClick={importFromThiings} disabled={importing}>
            {importing ? 'Importing…' : 'Import /data/Thiings'}
          </button>
        </div>
        {importMsg && <p className="hint" style={{ marginTop: 6 }}>{importMsg}</p>}
        {customOpen && (
          <div className="custom-emoji-panel">
            <input
              className="input"
              value={emojiSearch}
              placeholder="Search imported icons…"
              onChange={(e) => setEmojiSearch(e.target.value)}
            />
            {isCustomEmoji(emoji) && (
              <div className="selected-custom-icon">
                <TabIcon emoji={emoji} className="custom-emoji-preview" />
                <span>{customEmojiName(emoji)}</span>
              </div>
            )}
            <div className="custom-emoji-grid">
              {emojiItems.map((item) => (
                <button
                  key={item.name}
                  className={emoji === `emoji:${item.name}` ? 'active' : ''}
                  title={item.name}
                  onClick={() => setEmoji(`emoji:${item.name}`)}
                >
                  <img src={item.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
            {emojiItems.length === 0 && (
              <p className="hint" style={{ margin: '8px 0 0' }}>
                No imported icons yet. Put the zip in the data folder and import /data/Thiings.
              </p>
            )}
            {emojiItems.length < emojiTotal && (
              <button className="btn ghost small" style={{ marginTop: 8 }} onClick={() => loadEmojis(emojiOffset + 72)}>
                Show more
              </button>
            )}
          </div>
        )}

        <div className="hint">Color</div>
        <div className="color-row">
          {COLORS.map((c) => (
            <button key={c} className={color === c ? 'active' : ''} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {tab && <button className="btn danger small" onClick={remove}>Delete</button>}
          <div style={{ flex: 1 }} />
          <button className="btn ghost small" onClick={onClose}>Cancel</button>
          <button className="btn primary small" onClick={save} disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
