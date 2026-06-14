import { useEffect, useRef, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { api } from '../api';
import { appAlert, appConfirm, appPrompt } from '../components/dialog';
import type { AiSettings, Credential, Me, ReminderSettings, Tab } from '../types';
import TabEditor from '../components/TabEditor';
import pkg from '../../package.json';

interface Props {
  me: Me;
  tabs: Tab[];
  refreshTabs: () => void;
  refreshMe: () => void;
  showToast: (msg: string) => void;
}

const AI_PRESETS = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  { name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: '' },
];

export default function Settings({ me, tabs, refreshTabs, refreshMe, showToast }: Props) {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const [editingTab, setEditingTab] = useState<Tab | 'new' | null>(null);

  // Display name
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(me.username ?? '');
  const [nameMsg, setNameMsg] = useState('');

  async function saveName() {
    setNameMsg('');
    try {
      await api.put('/api/profile', { name: nameDraft });
      setNameOpen(false);
      refreshMe();
      showToast(`Nice to meet you, ${nameDraft.trim()} 🍃`);
    } catch (err: any) {
      setNameMsg(err.message);
    }
  }

  // AI
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [aiKey, setAiKey] = useState('');
  const [aiMsg, setAiMsg] = useState('');

  // TOTP
  const [totpSetup, setTotpSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpMsg, setTotpMsg] = useState('');

  // Passkeys
  const [creds, setCreds] = useState<Credential[]>([]);

  // Login activity
  const [activity, setActivity] = useState<{ attempts: any[] } | null>(null);

  // Restore
  const restoreRef = useRef<HTMLInputElement>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  async function restore(file?: File) {
    if (!file) return;
    const ok = await appConfirm({
      title: 'Restore from backup?',
      message: 'This REPLACES all current entries, tabs, photos and settings with the contents of the backup, and signs you out. This cannot be undone.',
      confirmLabel: 'Replace everything',
      danger: true,
    });
    if (!ok) return;
    setRestoreBusy(true);
    try {
      const form = new FormData();
      form.set('backup', file);
      const r = await api.form('POST', '/api/restore', form);
      await appAlert('Restore complete', `Restored ${r.entries} entries and ${r.photos} photos. Please sign in again.`);
      refreshMe(); // session was cleared server-side → back to login
    } catch (err: any) {
      appAlert('Restore failed', err.message || String(err));
    } finally {
      setRestoreBusy(false);
    }
  }

  // Daily reminder
  const [reminder, setReminder] = useState<ReminderSettings | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const pushSupported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // Password
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => {
    api.get('/api/settings/ai').then(setAi);
    api.get('/api/webauthn/credentials').then(setCreds);
    api.get('/api/settings/reminder').then(setReminder);
    api.get('/api/security/activity').then(setActivity).catch(() => {});
  }, []);

  async function logoutEverywhere() {
    const ok = await appConfirm({
      title: 'Sign out everywhere?',
      message: 'Every device — including this one — will need to sign in again.',
      confirmLabel: 'Sign out everywhere',
      danger: true,
    });
    if (!ok) return;
    await api.post('/api/security/logout-all');
    refreshMe();
  }

  async function ensurePushSubscription(): Promise<boolean> {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      appAlert('Notifications blocked', 'Allow notifications for this site in your browser settings, then try again.');
      return false;
    }
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api.get('/api/push/vapid-key');
    const keyBytes = Uint8Array.from(
      atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    );
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes,
    });
    await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
    return true;
  }

  async function toggleMemories(on: boolean) {
    setReminderBusy(true);
    try {
      if (on && !(await ensurePushSubscription())) return;
      setReminder(
        await api.put('/api/settings/reminder', {
          memories: on,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      );
      showToast(on ? 'Memory flashbacks on 🍂' : 'Memory flashbacks off');
    } catch (err: any) {
      appAlert('Could not update flashbacks', err.message || String(err));
    } finally {
      setReminderBusy(false);
    }
  }

  async function enableReminder() {
    setReminderBusy(true);
    try {
      if (!(await ensurePushSubscription())) return;
      setReminder(
        await api.put('/api/settings/reminder', {
          enabled: true,
          time: reminder?.time ?? '20:00',
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      );
      showToast('Daily reminder on 🔔');
    } catch (err: any) {
      appAlert(
        'Could not enable reminders',
        `${err.message || err}\n\nNote: push needs HTTPS, and on iPhone the app must be installed to the Home Screen first (iOS 16.4+).`
      );
    } finally {
      setReminderBusy(false);
    }
  }

  async function disableReminder() {
    setReminderBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setReminder(await api.put('/api/settings/reminder', { enabled: false }));
      showToast('Daily reminder off');
    } finally {
      setReminderBusy(false);
    }
  }

  async function setReminderTime(time: string) {
    setReminder(
      await api.put('/api/settings/reminder', {
        time,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
    );
  }

  async function testReminder() {
    try {
      await api.post('/api/push/test');
      showToast('Test notification sent 🔔');
    } catch (err: any) {
      appAlert('Test failed', err.message);
    }
  }

  function setThemeAndSave(t: string) {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem('dayleaf-theme', t);
  }

  async function saveAi(patch: Partial<{ baseUrl: string; model: string; apiKey: string }>) {
    await api.put('/api/settings/ai', patch);
    setAi(await api.get('/api/settings/ai'));
  }

  async function testAi() {
    setAiMsg('Testing…');
    try {
      if (aiKey) { await saveAi({ apiKey: aiKey }); setAiKey(''); }
      await api.post('/api/ai/test');
      setAiMsg('✅ Connected — AI recall is ready.');
    } catch (err: any) {
      setAiMsg(`❌ ${err.message}`);
    }
  }

  async function startTotp() {
    const { secret, uri } = await api.post('/api/totp/setup');
    const qr = await QRCode.toDataURL(uri, { width: 380, margin: 1 });
    setTotpSetup({ qr, secret });
    setTotpMsg('');
  }

  async function confirmTotp() {
    try {
      await api.post('/api/totp/enable', { code: totpCode });
      setTotpSetup(null);
      setTotpCode('');
      refreshMe();
      showToast('Authenticator enabled 🔐');
    } catch (err: any) {
      setTotpMsg(err.message);
    }
  }

  async function disableTotp() {
    const code = await appPrompt({
      title: 'Turn off 2FA?',
      message: 'Enter a current code from your authenticator app to confirm.',
      placeholder: '123 456',
      inputMode: 'numeric',
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (!code) return;
    try {
      await api.post('/api/totp/disable', { code });
      refreshMe();
      showToast('Authenticator disabled');
    } catch (err: any) {
      appAlert('Could not turn off 2FA', err.message);
    }
  }

  async function addPasskey() {
    try {
      const options = await api.post('/api/webauthn/register-options');
      const response = await startRegistration(options);
      await api.post('/api/webauthn/register-verify', { response, nickname: 'This device' });
      setCreds(await api.get('/api/webauthn/credentials'));
      refreshMe();
      showToast('Biometric unlock added 🔐');
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') {
        appAlert(
          'Could not add a passkey',
          `${err.message || err}\n\nNote: biometric unlock requires HTTPS (or http://localhost) and a hostname, not an IP address.`
        );
      }
    }
  }

  async function removePasskey(id: string) {
    const ok = await appConfirm({
      title: 'Remove this passkey?',
      message: 'Biometric unlock from that device will stop working.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/webauthn/credentials/${encodeURIComponent(id)}`);
    setCreds(await api.get('/api/webauthn/credentials'));
    refreshMe();
  }

  async function changePassword() {
    setPwMsg('');
    try {
      await api.post('/api/password', { current: pwCurrent, next: pwNext });
      setPwOpen(false);
      setPwCurrent('');
      setPwNext('');
      showToast('Password changed');
    } catch (err: any) {
      setPwMsg(err.message);
    }
  }

  async function logout() {
    await api.post('/api/logout');
    refreshMe();
  }

  return (
    <>
      <h2 className="section">Profile</h2>
      <div className="card">
        <div className="settings-row">
          <div className="grow">
            <div className="title">Your name</div>
            <div className="sub">How Dayleaf greets you — currently “{me.username}”</div>
          </div>
          <button className="btn small" onClick={() => { setNameDraft(me.username ?? ''); setNameOpen(!nameOpen); }}>
            Change
          </button>
        </div>
        {nameOpen && (
          <div style={{ padding: '4px 0 12px', display: 'flex', gap: 8 }}>
            <input
              className="input"
              value={nameDraft}
              maxLength={60}
              autoFocus
              placeholder="What should we call you?"
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
            />
            <button className="btn primary small" onClick={saveName} disabled={!nameDraft.trim()}>
              Save
            </button>
          </div>
        )}
        {nameMsg && <p className="error-text">{nameMsg}</p>}
      </div>

      <h2 className="section">Appearance</h2>
      <div className="card">
        <div className="settings-row">
          <div className="grow">
            <div className="title">Theme</div>
            <div className="sub">Dayleaf follows your system by default</div>
          </div>
          <select className="date-input" value={theme} onChange={(e) => setThemeAndSave(e.target.value)}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      <h2 className="section">Tabs</h2>
      <div className="card">
        {tabs.map((t) => (
          <div className="tab-manage-row" key={t.id}>
            <span className="swatch" style={{ background: t.color }} />
            <span className="grow" style={{ flex: 1 }}>{t.emoji} {t.name}</span>
            <button className="btn ghost small" onClick={() => setEditingTab(t)}>Edit</button>
          </div>
        ))}
        <button className="btn small" style={{ marginTop: 8 }} onClick={() => setEditingTab('new')}>
          ＋ New tab
        </button>
      </div>

      <h2 className="section">AI recall</h2>
      <div className="card">
        <label className="field">
          Provider preset
          <select
            className="input"
            value=""
            onChange={(e) => {
              const p = AI_PRESETS.find((x) => x.name === e.target.value);
              if (p) saveAi({ baseUrl: p.baseUrl, model: p.model });
            }}
          >
            <option value="">Choose a preset…</option>
            {AI_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          API base URL
          <input
            className="input"
            value={ai?.baseUrl ?? ''}
            onChange={(e) => setAi(ai && { ...ai, baseUrl: e.target.value })}
            onBlur={() => ai && saveAi({ baseUrl: ai.baseUrl })}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label className="field">
          Model
          <input
            className="input"
            value={ai?.model ?? ''}
            onChange={(e) => setAi(ai && { ...ai, model: e.target.value })}
            onBlur={() => ai && saveAi({ model: ai.model })}
            placeholder="gpt-4o-mini"
          />
        </label>
        <label className="field">
          API key {ai?.hasKey && <span style={{ color: 'var(--accent)' }}>• saved</span>}
          <input
            className="input"
            type="password"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
            placeholder={ai?.hasKey ? '•••••••• (enter to replace)' : 'sk-…'}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary small" onClick={testAi}>Save & test connection</button>
        </div>
        {aiMsg && <p className="hint" style={{ marginBottom: 0 }}>{aiMsg}</p>}
        <p className="hint">
          Works with OpenAI, Claude, OpenRouter, Ollama, LM Studio, or any OpenAI-compatible API.
          Your key is stored only on your own server.
        </p>
      </div>

      <h2 className="section">Reminders</h2>
      <div className="card">
        <div className="settings-row">
          <div className="grow">
            <div className="title">Daily reminder</div>
            <div className="sub">
              {pushSupported
                ? 'A gentle nudge if you haven’t journaled by your chosen time'
                : 'Not supported in this browser — on iPhone, install Dayleaf to the Home Screen first'}
            </div>
          </div>
          {reminder?.enabled ? (
            <button className="btn danger small" onClick={disableReminder} disabled={reminderBusy}>
              Turn off
            </button>
          ) : (
            <button className="btn small" onClick={enableReminder} disabled={reminderBusy || !pushSupported}>
              Turn on
            </button>
          )}
        </div>

        <div className="settings-row">
          <div className="grow">
            <div className="title">“On this day” flashbacks</div>
            <div className="sub">A morning note (~9:00) when today has memories from months or years past</div>
          </div>
          {reminder?.memories ? (
            <button className="btn danger small" onClick={() => toggleMemories(false)} disabled={reminderBusy}>
              Turn off
            </button>
          ) : (
            <button className="btn small" onClick={() => toggleMemories(true)} disabled={reminderBusy || !pushSupported}>
              Turn on
            </button>
          )}
        </div>

        {reminder?.enabled && (
          <>
            <div className="settings-row">
              <div className="grow">
                <div className="title">Remind me at</div>
                <div className="sub">In your local timezone ({reminder.tz})</div>
              </div>
              <input
                className="date-input"
                type="time"
                value={reminder.time}
                onChange={(e) => e.target.value && setReminderTime(e.target.value)}
              />
            </div>
            <div className="settings-row">
              <div className="grow">
                <div className="title">Test it</div>
                <div className="sub">
                  {reminder.subscriptions} {reminder.subscriptions === 1 ? 'device' : 'devices'} will be notified
                </div>
              </div>
              <button className="btn small" onClick={testReminder}>Send test</button>
            </div>
            <p className="hint" style={{ marginBottom: 4 }}>
              Skipped automatically on days you’ve already journaled. Turn it on from each device
              (phone, desktop) you want notified.
            </p>
          </>
        )}
      </div>

      <h2 className="section">Security</h2>
      <div className="card">
        <div className="settings-row">
          <div className="grow">
            <div className="title">Password</div>
            <div className="sub">Used to unlock your journal</div>
          </div>
          <button className="btn small" onClick={() => setPwOpen(!pwOpen)}>Change</button>
        </div>
        {pwOpen && (
          <div style={{ padding: '4px 0 12px' }}>
            <label className="field">
              Current password
              <input className="input" type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
            </label>
            <label className="field">
              New password (8+ characters)
              <input className="input" type="password" value={pwNext} onChange={(e) => setPwNext(e.target.value)} />
            </label>
            {pwMsg && <p className="error-text">{pwMsg}</p>}
            <button className="btn primary small" onClick={changePassword}>Update password</button>
          </div>
        )}

        <div className="settings-row">
          <div className="grow">
            <div className="title">Authenticator app (2FA)</div>
            <div className="sub">Google Authenticator, Authy, 1Password…</div>
          </div>
          {me.totpEnabled ? (
            <button className="btn danger small" onClick={disableTotp}>Disable</button>
          ) : (
            <button className="btn small" onClick={startTotp}>Enable</button>
          )}
        </div>

        {totpSetup && (
          <div className="qr-box">
            <img src={totpSetup.qr} alt="TOTP QR code" />
            <p className="hint" style={{ textAlign: 'center', margin: 0 }}>
              Scan with your authenticator app, then enter the 6-digit code.
            </p>
            <code>{totpSetup.secret}</code>
            <input
              className="input"
              style={{ maxWidth: 200, textAlign: 'center' }}
              inputMode="numeric"
              placeholder="123 456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
            {totpMsg && <p className="error-text">{totpMsg}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost small" onClick={() => setTotpSetup(null)}>Cancel</button>
              <button className="btn primary small" onClick={confirmTotp}>Verify & enable</button>
            </div>
          </div>
        )}

        <div className="settings-row">
          <div className="grow">
            <div className="title">Biometric unlock</div>
            <div className="sub">Face ID / fingerprint via passkeys (needs HTTPS)</div>
          </div>
          <button className="btn small" onClick={addPasskey}>Add this device</button>
        </div>
        {creds.map((c) => (
          <div className="settings-row" key={c.id}>
            <div className="grow">
              <div className="title" style={{ fontWeight: 400 }}>🔑 {c.nickname}</div>
              <div className="sub">Added {c.created_at.slice(0, 10)}</div>
            </div>
            <button className="btn ghost small" onClick={() => removePasskey(c.id)}>Remove</button>
          </div>
        ))}

        <div className="settings-row">
          <div className="grow">
            <div className="title">Session</div>
            <div className="sub">Signed in as {me.username}</div>
          </div>
          <button className="btn small" onClick={logout}>Sign out</button>
        </div>

        <div className="settings-row">
          <div className="grow">
            <div className="title">All devices</div>
            <div className="sub">Lost a device? End every active session at once</div>
          </div>
          <button className="btn danger small" onClick={logoutEverywhere}>Sign out everywhere</button>
        </div>
      </div>

      {activity && activity.attempts.length > 0 && (
        <>
          <h2 className="section">Recent login activity</h2>
          <div className="card">
            {activity.attempts.map((a) => (
              <div className="settings-row" key={a.id}>
                <div className="grow">
                  <div className="title" style={{ fontWeight: 500 }}>
                    {a.success ? '✅' : '⚠️'} {a.success ? 'Signed in' : 'Failed attempt'} · {a.method}
                  </div>
                  <div className="sub">
                    {new Date(`${a.created_at.replace(' ', 'T')}Z`).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}{' '}
                    · {a.ip}
                  </div>
                </div>
              </div>
            ))}
            <p className="hint" style={{ marginBottom: 4 }}>
              Repeated failures trigger a cooldown automatically — and a push notification if
              reminders are set up on any device.
            </p>
          </div>
        </>
      )}

      <h2 className="section">Data</h2>
      <div className="card">
        <div className="settings-row">
          <div className="grow">
            <div className="title">Full backup</div>
            <div className="sub">Download everything — entries, tabs, settings & photos — in one restorable file</div>
          </div>
          <a className="btn small" href="/api/backup" download>Download</a>
        </div>
        <div className="settings-row">
          <div className="grow">
            <div className="title">Restore from backup</div>
            <div className="sub">Replace all current data with a backup file</div>
          </div>
          <button className="btn small" onClick={() => restoreRef.current?.click()} disabled={restoreBusy}>
            {restoreBusy ? 'Restoring…' : 'Restore'}
          </button>
          <input
            ref={restoreRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => { restore(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
        <div className="settings-row">
          <div className="grow">
            <div className="title">Export entries (text only)</div>
            <div className="sub">A lightweight JSON of tabs & entries, no photos</div>
          </div>
          <a className="btn small" href="/api/export" download>Export</a>
        </div>
        <p className="hint" style={{ marginBottom: 4 }}>
          The backup file contains your journal and credentials — keep it somewhere safe.
        </p>
      </div>

      <p className="hint" style={{ textAlign: 'center', margin: '22px 0 4px' }}>
        Dayleaf v{pkg.version} 🍃 — your days, one leaf at a time
      </p>
      <p className="hint kbd-hint" style={{ textAlign: 'center', margin: '0 0 22px' }}>
        Keyboard: <kbd>N</kbd> new entry · <kbd>/</kbd> search · <kbd>G</kbd> photos
      </p>

      {editingTab && (
        <TabEditor
          tab={editingTab === 'new' ? null : editingTab}
          onClose={() => setEditingTab(null)}
          onSaved={() => { setEditingTab(null); refreshTabs(); }}
        />
      )}
    </>
  );
}
