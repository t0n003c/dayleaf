import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Tab } from '../types';
import EmojiInsertPicker from './EmojiInsertPicker';
import EntryText, { emojiToken, hasEmojiTokens } from './EntryText';
import { tabIconText } from './TabIcon';

const MOODS = ['😄', '🙂', '😐', '😕', '😣'];

interface Props {
  tabs: Tab[];
  defaultTab: number;
  onSaved: () => void;
  onClose?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function Composer({ tabs, defaultTab, onSaved, onClose, placeholder, autoFocus }: Props) {
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
  useEffect(() => () => document.body.classList.remove('writing'), []);

  // Auto-grow the textarea with content.
  useEffect(() => {
    const el = textRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.max(64, el.scrollHeight)}px`;
    }
  }, [content]);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    // Snapshot immediately: the FileList is LIVE, and the change handler
    // clears input.value right after this — if React defers the state
    // updater, a lazily-read FileList would already be empty.
    const picked = Array.from(list);
    setPhotos((prev) => [...prev, ...picked].slice(0, 6));
  }

  function insertEmoji(name: string) {
    const token = emojiToken(name);
    const el = textRef.current;
    if (!el) {
      setContent((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token} `);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const insert = `${before && !/\s$/.test(before) ? ' ' : ''}${token}${after && !/^\s/.test(after) ? ' ' : ''}`;
    const next = `${before}${insert}${after}`;
    setContent(next);
    window.requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + insert.length;
      el.setSelectionRange(pos, pos);
    });
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
      {onClose && (
        <button className="composer-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      )}
      <textarea
        ref={textRef}
        placeholder={placeholder ?? 'What happened today?'}
        autoFocus={autoFocus}
        value={content}
        onFocus={() => { if (window.matchMedia('(min-width: 700px)').matches) document.body.classList.add('writing'); }}
        onBlur={() => document.body.classList.remove('writing')}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
        }}
      />
      {hasEmojiTokens(content) && (
        <div className="entry-live-preview">
          <EntryText text={content} />
        </div>
      )}

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
        <div className="composer-tools">
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
          <div className="photo-btns">
            <EmojiInsertPicker onPick={insertEmoji} />
            <button className="icon-btn" title="Take a photo" onClick={() => cameraRef.current?.click()}>
              📷
            </button>
            <button className="icon-btn" title="Attach images" onClick={() => fileRef.current?.click()}>
              🖼️
            </button>
          </div>
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
        </div>

        <div className="composer-actions">
          <input
            className="date-input"
            type="date"
            value={date}
            max={new Date().toLocaleDateString('sv')}
            onChange={(e) => setDate(e.target.value)}
          />
          {tabs.length > 1 && (
            <select
              className="date-input tab-select"
              value={tabId}
              onChange={(e) => setTabId(Number(e.target.value))}
            >
              {tabs.map((t) => (
                <option key={t.id} value={t.id}>
                  {tabIconText(t.emoji)} {t.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn primary small" onClick={save} disabled={busy || (!content.trim() && photos.length === 0)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
