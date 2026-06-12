import { useRef, useState } from 'react';
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
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const time = new Date(`${entry.created_at.replace(' ', 'T')}Z`).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
  });

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list); // snapshot: the FileList is live
    setNewPhotos((prev) =>
      [...prev, ...picked].slice(0, Math.max(0, 6 - entry.attachments.length))
    );
  }

  async function saveEdit() {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('content', draft);
      for (const p of newPhotos) form.append('photos', p);
      await api.form('PUT', `/api/entries/${entry.id}`, form);
      setEditing(false);
      setNewPhotos([]);
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
            <button className="btn ghost small" onClick={() => { setEditing(false); setDraft(entry.content); setNewPhotos([]); }}>
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

      {editing && (
        <div className="pending-photos" style={{ marginTop: 10 }}>
          {entry.attachments.map((a) => (
            <div className="thumb" key={a.id}>
              <img src={`/api/files/${a.filename}?thumb=1`} alt="" />
              <button className="remove" title="Delete photo" onClick={() => removePhoto(a)}>
                ✕
              </button>
            </div>
          ))}
          {newPhotos.map((p, i) => (
            <div className="thumb" key={`new-${i}`}>
              <img src={URL.createObjectURL(p)} alt="" />
              <button className="remove" title="Remove" onClick={() => setNewPhotos(newPhotos.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          {entry.attachments.length + newPhotos.length < 6 && (
            <>
              <button className="add-photo-tile" title="Take a photo" onClick={() => cameraRef.current?.click()}>
                📷
              </button>
              <button className="add-photo-tile" title="Attach images" onClick={() => fileRef.current?.click()}>
                🖼️
              </button>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              <input ref={fileRef} type="file" accept="image/*" multiple hidden
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </>
          )}
        </div>
      )}

      {!editing && entry.attachments.length > 0 && (
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
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </article>
  );
}
