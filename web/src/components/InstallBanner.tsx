import { useEffect, useState } from 'react';

// Nudges mobile visitors to install the PWA. Android browsers fire
// `beforeinstallprompt`, which we capture to offer a real Install button.
// iOS has no prompt API, so we show the Share → Add to Home Screen steps.
// Hidden when already running as an installed app; dismissing snoozes it.

const SNOOZE_KEY = 'dayleaf-install-dismissed';
const SNOOZE_DAYS = 14;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  );
}

function isIos() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS reports as Mac but has touch
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function snoozed() {
  const t = Number(localStorage.getItem(SNOOZE_KEY) || 0);
  return Date.now() - t < SNOOZE_DAYS * 86400_000;
}

export default function InstallBanner() {
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [show, setShow] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (isStandalone() || snoozed()) return;
    const mobile = window.matchMedia('(pointer: coarse)').matches;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      if (mobile) {
        setInstallEvent(e);
        setShow(true);
      }
    };
    const onInstalled = () => setShow(false);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (ios && mobile) setShow(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [ios]);

  if (!show) return null;

  async function install() {
    if (!installEvent) return;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') setShow(false);
  }

  function dismiss() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    setShow(false);
  }

  return (
    <div className="install-banner">
      <img src="/icons/icon.svg" alt="" />
      <div className="ib-text">
        <div className="ib-title">Install Dayleaf</div>
        <div className="ib-sub">
          {ios
            ? 'Tap the Share button, then “Add to Home Screen”'
            : 'Add it to your home screen for quick journaling'}
        </div>
      </div>
      {!ios && (
        <button className="btn primary small" onClick={install}>
          Install
        </button>
      )}
      <button className="ib-close" onClick={dismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
