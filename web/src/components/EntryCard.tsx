import { useState } from 'react';
import { api } from '../api';
import { appConfirm } from './dialog';
import type { Attachment, Entry, Tab } from '../types';

interface Props {
  entry: Entry;
  tabs: Tab[];
  showTab: boolean;
  onChanged: () => void;
  stagger?: number;
}

export default function EntryCard({ entry, tabs, showTab, onChanged, stagger }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const time = new Date(`${entry.created_at.replace(' ', 'T')}Z`).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
  });

  async function saveEdit() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('content', draft);
      await api.form('PUT', `/api/entries/${entry.id}`, form);
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(a: Attachment) {
    const ok = await appConfirm({
      title: 'Delete this photo?',
      message: 'It will be removed from this entry. This cannot be undone.',
      confirmLabel: 'Delete photo',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/attachments/${a.id}`);
    onChanged();
  }

  async function remove() {
    const ok = await appConfirm({
      title: 'Delete this entry?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/entries/${entry.id}`);
    onChanged();
  }

  return (
    <article className="card entry-card" style={{ ['--stagger' as any]: stagger ?? 0 }}>
      <div className="entry-head">
        {showTab && (
          <span className="tab-pill" style={{ color: entry.tab_color }}>
            {entry.tab_emoji} {entry.tab_name}
          </span>
        )}
        {entry.mood && <span className="mood">{entry.mood}</span>}
        <span>{time}</span>
        <span className="spacer" />
        {editing ? (
          <div className="entry-actions" style={{ opacity: 1 }}>
            <button className="btn ghost small" onClick={() => { setEditing(false); setDraft(entry.content); }}>
              Cancel
            </button>
            <button className="btn primary small" onClick={saveEdit} disabled={busy}>
              Save
            </button>
          </div>
        ) : (
          <div className="entry-actions">
            <button className="btn ghost small" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn ghost small" onClick={remove}>Delete</button>
          </div>
        )}
      </div>

      {editing ? (
        <textarea
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.max(3, draft.split('\n').length)}
          autoFocus
        />
      ) : (
        <div className="entry-content">{entry.content}</div>
      )}

      {entry.attachments.length > 0 && (
        editing ? (
          <div className="pending-photos" style={{ marginTop: 10 }}>
            {entry.attachments.map((a) => (
              <div className="thumb" key={a.id}>
                <img src={`/api/files/${a.filename}?thumb=1`} alt="" />
                <button className="remove" title="Delete photo" onClick={() => removePhoto(a)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="entry-photos">
            {entry.attachments.map((a) => (
              <img
                key={a.id}
                src={`/api/files/${a.filename}?thumb=1`}
                alt=""
                loading="lazy"
                onClick={() => setLightbox(`/api/files/${a.filename}`)}
              />
            ))}
          </div>
        )
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </article>
  );
}
