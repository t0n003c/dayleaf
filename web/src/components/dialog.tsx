import { useCallback, useEffect, useState } from 'react';

// In-app replacement for window.confirm/alert/prompt — native dialogs show
// the site origin ("dayleaf.example.com says"), these speak as Dayleaf.
// Imperative API backed by a single <DialogHost /> mounted in App.

interface Spec {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  showCancel: boolean;
  withInput?: { placeholder?: string; inputMode?: 'numeric' | 'text' };
}

interface Pending extends Spec {
  resolve: (v: any) => void;
}

let enqueue: ((p: Pending) => void) | null = null;

export function appConfirm(spec: Omit<Spec, 'showCancel'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!enqueue) return resolve(window.confirm(`${spec.title}\n\n${spec.message ?? ''}`));
    enqueue({ ...spec, showCancel: true, resolve: (v) => resolve(!!v) });
  });
}

export function appAlert(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!enqueue) { window.alert(`${title}\n\n${message ?? ''}`); return resolve(); }
    enqueue({ title, message, showCancel: false, confirmLabel: 'OK', resolve: () => resolve() });
  });
}

export function appPrompt(spec: Omit<Spec, 'showCancel' | 'withInput'> & { placeholder?: string; inputMode?: 'numeric' | 'text' }): Promise<string | null> {
  return new Promise((resolve) => {
    if (!enqueue) return resolve(window.prompt(`${spec.title}\n\n${spec.message ?? ''}`));
    enqueue({
      ...spec,
      showCancel: true,
      withInput: { placeholder: spec.placeholder, inputMode: spec.inputMode },
      resolve: (v) => resolve(typeof v === 'string' && v.trim() ? v.trim() : null),
    });
  });
}

export function DialogHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [value, setValue] = useState('');

  useEffect(() => {
    enqueue = (p) => setQueue((q) => [...q, p]);
    return () => { enqueue = null; };
  }, []);

  const cur = queue[0];

  const close = useCallback((result: any) => {
    cur?.resolve(result);
    setQueue((q) => q.slice(1));
    setValue('');
  }, [cur]);

  useEffect(() => {
    if (!cur) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(cur.withInput ? null : cur.showCancel ? false : true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cur, close]);

  if (!cur) return null;

  const dismiss = () => close(cur.withInput ? null : cur.showCancel ? false : true);

  return (
    <div className="modal-overlay dialog-overlay" onClick={dismiss}>
      <div className="modal card app-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-brand">
          <img src="/icons/icon.svg" alt="" /> Dayleaf
        </div>
        <h3 className="dialog-title">{cur.title}</h3>
        {cur.message && <p className="dialog-msg">{cur.message}</p>}
        {cur.withInput && (
          <input
            className="input"
            autoFocus
            value={value}
            placeholder={cur.withInput.placeholder}
            inputMode={cur.withInput.inputMode}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') close(value); }}
          />
        )}
        <div className="dialog-actions">
          {cur.showCancel && (
            <button className="btn ghost small" onClick={() => close(cur.withInput ? null : false)}>
              {cur.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            className={`btn small ${cur.danger ? 'danger-solid' : 'primary'}`}
            autoFocus={!cur.withInput}
            onClick={() => close(cur.withInput ? value : true)}
          >
            {cur.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
