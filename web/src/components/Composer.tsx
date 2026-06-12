import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Tab } from '../types';

const MOODS = ['😄', '🙂', '😐', '😕', '😣'];

interface Props {
  tabs: Tab[];
  defaultTab: number;
  onSaved: () => void;
}

export default function Composer({ tabs, defaultTab, onSaved }: Props) {
  const [tabId, setTabId] = useState(defaultTab);
  const [content, setContent] = useState('');
  const [mood, setMood] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv'));
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setTabId(defaultTab); }, [defaultTab]);

  // Auto-grow the textarea with content.
  useEffect(() => {
    const el = textRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.max(64, el.scrollHeight)}px`;
    }
  }, [content]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setPhotos((prev) => [...prev, ...Array.from(list)].slice(0, 6));
  }

  async function save() {
    if (!content.trim() && photos.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('tab_id', String(tabId));
      form.set('content', content);
      form.set('mood', mood);
      form.set('entry_date', date);
      for (const p of photos) form.append('photos', p);
      await api.form('POST', '/api/entries', form);
      setContent('');
      setMood('');
      setPhotos([]);
      setDate(new Date().toLocaleDateString('sv'));
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card composer">
      <textarea
        ref={textRef}
        placeholder="What happened today?"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
        }}
      />

      {photos.length > 0 && (
        <div className="pending-photos">
          {photos.map((p, i) => (
            <div className="thumb" key={i}>
              <img src={URL.createObjectURL(p)} alt="" />
              <button className="remove" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="composer-foot">
        <div className="mood-row">
          {MOODS.map((m) => (
            <button
              key={m}
              className={`mood-btn ${mood === m ? 'active' : ''}`}
              onClick={() => setMood(mood === m ? '' : m)}
              title="Mood"
            >
              {m}
            </button>
          ))}
        </div>

        <button className="icon-btn" title="Take a photo" onClick={() => cameraRef.current?.click()}>
          📷
        </button>
        <button className="icon-btn" title="Attach images" onClick={() => fileRef.current?.click()}>
          🖼️
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />

        <input
          className="date-input"
          type="date"
          value={date}
          max={new Date().toLocaleDateString('sv')}
          onChange={(e) => setDate(e.target.value)}
        />

        <div className="grow" />

        {tabs.length > 1 && (
          <select className="date-input" value={tabId} onChange={(e) => setTabId(Number(e.target.value))}>
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.emoji} {t.name}
              </option>
            ))}
          </select>
        )}

        <button className="btn primary small" onClick={save} disabled={busy || (!content.trim() && photos.length === 0)}>
          Save
        </button>
      </div>
    </div>
  );
}
