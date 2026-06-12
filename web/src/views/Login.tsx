import { useEffect, useRef, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api';
import LeafRain from '../components/LeafRain';
import type { Me } from '../types';

// When passkeys are enrolled, login is biometric-first: the prompt fires
// automatically on load, and the password (+ authenticator code) form only
// appears after biometric fails or is dismissed. The OS itself handles the
// Face ID -> fingerprint -> device passcode fallback chain inside the prompt.

export default function Login({ me, onDone }: { me: Me; onDone: () => void }) {
  const [usePassword, setUsePassword] = useState(!me.hasPasskeys);
  const [bioTrying, setBioTrying] = useState(false);
  const [bioFailed, setBioFailed] = useState(false);
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  async function biometric() {
    setBioTrying(true);
    setError('');
    try {
      const options = await api.post('/api/webauthn/login-options');
      const response = await startAuthentication(options);
      await api.post('/api/webauthn/login-verify', { response });
      onDone();
      return;
    } catch (err: any) {
      setBioFailed(true);
      // Cancelled prompts (NotAllowedError) aren't worth an error message.
      if (err?.name !== 'NotAllowedError' && err?.message) setError(err.message);
    } finally {
      setBioTrying(false);
    }
  }

  useEffect(() => {
    if (me.hasPasskeys && !autoTried.current) {
      autoTried.current = true;
      const t = window.setTimeout(biometric, 350);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/api/login', { password, totp: totp || undefined });
      onDone();
    } catch (err: any) {
      if (err.body?.totpRequired) setTotpRequired(true);
      setError(err.body?.error || (err.body?.totpRequired ? '' : err.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <LeafRain />
      <div className="auth-card card">
        <img className="mark" src="/icons/icon.svg" alt="Dayleaf" />
        <h1>Dayleaf</h1>
        <p className="tagline">Welcome back. Unlock your journal.</p>

        {!usePassword ? (
          bioTrying ? (
            <div className="bio-wait">
              <span className="bio-icon">🔐</span>
              Waiting for Face ID / fingerprint…
            </div>
          ) : (
            <>
              {error && <p className="error-text" style={{ textAlign: 'center' }}>{error}</p>}
              {bioFailed && !error && (
                <p className="hint" style={{ textAlign: 'center', marginTop: 0 }}>
                  Biometric unlock didn’t go through.
                </p>
              )}
              <button className="btn primary" style={{ width: '100%' }} onClick={biometric}>
                🔐 {bioFailed ? 'Try Face ID / fingerprint again' : 'Unlock with Face ID / fingerprint'}
              </button>
              {bioFailed && (
                <button
                  className="btn ghost"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={() => { setUsePassword(true); setError(''); }}
                >
                  Use password{me.totpEnabled ? ' + authenticator code' : ''} instead
                </button>
              )}
            </>
          )
        ) : (
          <form onSubmit={submit}>
            <label className="field">
              Password
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
            </label>
            {totpRequired && (
              <label className="field">
                Authenticator code
                <input
                  className="input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                />
              </label>
            )}
            {error && <p className="error-text">{error}</p>}
            <button className="btn primary" disabled={busy}>Unlock</button>
            {me.hasPasskeys && (
              <button
                type="button"
                className="btn ghost"
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => { setUsePassword(false); setError(''); biometric(); }}
              >
                ← Back to Face ID / fingerprint
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
