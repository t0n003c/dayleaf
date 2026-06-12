import { useState } from 'react';
import { api } from '../api';
import type { Tab } from '../types';

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
    if (!confirm(`Delete "${tab.name}" and ALL of its entries? This cannot be undone.`)) return;
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
