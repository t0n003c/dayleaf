import { useEffect, useRef } from 'react';

// Cloudflare Turnstile widget. The api.js script is loaded once (shared across
// mounts), then the widget is rendered explicitly into our own div so it plays
// nicely with React. The parent gets the token via onToken; to reset after a
// failed login, the parent remounts this component with a changed `key` (the
// cleanup removes the old widget, the next render mints a fresh, single-use
// token). Theme follows the app's light/dark setting.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error('Failed to load Turnstile')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface Props {
  siteKey: string;
  onToken: (token: string) => void;
  onError?: () => void;
}

export default function Turnstile({ siteKey, onToken, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          callback: (token: string) => onToken(token),
          'error-callback': () => { onToken(''); onError?.(); },
          'expired-callback': () => onToken(''),
        });
      })
      .catch(() => onError?.());
    return () => {
      cancelled = true;
      try {
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      } catch { /* widget already gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="turnstile" ref={ref} />;
}
