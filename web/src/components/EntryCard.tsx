import { useRef, useState } from 'react';
import { api } from '../api';
import { appConfirm } from './dialog';
import type { Attachment, Entry, Tab } from '../types';
import TabIcon, { tabIconText } from './TabIcon';

interface Props {
  entry: Entry;
  tabs: Tab[];
  showTab: boolean;
  onChanged: () => void;
  stagger?: number;
  onBeginDrag?: (entry: Entry, x: number, y: number) => void;
}

export default function EntryCard({ entry, tabs, showTab, onChanged, stagger, onBeginDrag }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [draftTab, setDraftTab] = useState(entry.tab_id);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One pointer gesture decides: quick tap → edit, vertical move → (native)
  // scroll, press-and-hold → start a drag-to-move. touch-action:pan-y on the
  // card lets the timeline scroll, which fires pointercancel and aborts the
  // hold — so scrolling never starts a drag.
  const pressTimer = useRef(0);
  const start = useRef({ x: 0, y: 0 });
  const dragStarted = useRef(false);
  const HOLD_MS = 400;
  const MOVE_TOL = 10;

  function interactive(target: EventTarget | null) {
    return !!(target as HTMLElement)?.closest?.('button, a, img, input, textarea, select');
  }

  function clearHold() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = 0; }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (editing || e.button === 2 || interactive(e.target)) return;
    start.current = { x: e.clientX, y: e.clientY };
    dragStarted.current = false;
    if (!onBeginDrag) return;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = 0;
      dragStarted.current = true;
      onBeginDrag(entry, start.current.x, start.current.y);
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pressTimer.current) return;
    if (Math.abs(e.clientX - start.current.x) > MOVE_TOL || Math.abs(e.clientY - start.current.y) > MOVE_TOL) {
      clearHold(); // it's a scroll/scrub, not a hold
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    clearHold();
    if (dragStarted.current) { dragStarted.current = false; return; } // the drag handled it
    if (editing || interactive(e.target)) return;
    if (Math.abs(e.clientX - start.current.x) <= MOVE_TOL && Math.abs(e.clientY - start.current.y) <= MOVE_TOL) {
      setEditing(true); // a tap → edit
    }
  }

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
      form.set('tab_id', String(draftTab));
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
    <article
      className={`card entry-card ${editing ? 'editing' : 'tappable'}`}
      style={{ ['--stagger' as any]: stagger ?? 0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={clearHold}
      title={editing ? undefined : 'Tap to edit · press and hold to move to another journal'}
    >
      <div className="entry-head">
        {showTab && (
          <span className="tab-pill" style={{ color: entry.tab_color }}>
            <TabIcon emoji={entry.tab_emoji} className="inline-tab-icon" /> {entry.tab_name}
          </span>
        )}
        {entry.mood && <span className="mood">{entry.mood}</span>}
        <span>{time}</span>
        <span className="spacer" />
        {editing ? (
          <div className="entry-actions" style={{ opacity: 1 }}>
            <button className="btn ghost small" onClick={() => { setEditing(false); setDraft(entry.content); setDraftTab(entry.tab_id); setNewPhotos([]); }}>
              Cancel
            </button>
            <button className="btn primary small" onClick={saveEdit} disabled={busy}>
              Save
            </button>
          </div>
        ) : (
          <button className="entry-delete" title="Delete entry" onClick={remove} aria-label="Delete entry">
            ✕
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(3, draft.split('\n').length)}
            autoFocus
          />
          {tabs.length > 1 && (
            <label className="entry-move">
              <span>Journal</span>
              <select
                className="date-input tab-select"
                value={draftTab}
                onChange={(e) => setDraftTab(Number(e.target.value))}
              >
                {tabs.map((t) => (
                  <option key={t.id} value={t.id}>{tabIconText(t.emoji)} {t.name}</option>
                ))}
              </select>
            </label>
          )}
        </>
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
