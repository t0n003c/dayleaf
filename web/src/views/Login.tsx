import { useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api';
import type { Me } from '../types';

export default function Login({ me, onDone }: { me: Me; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  async function biometric() {
    setError('');
    try {
      const options = await api.post('/api/webauthn/login-options');
      const response = await startAuthentication(options);
      await api.post('/api/webauthn/login-verify', { response });
      onDone();
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') setError(err.message || 'Biometric sign-in failed');
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card card">
        <img className="mark" src="/icons/icon.svg" alt="Dayleaf" />
        <h1>Dayleaf</h1>
        <p className="tagline">Welcome back. Unlock your journal.</p>
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
            <button type="button" className="btn" onClick={biometric} style={{ marginTop: 8 }}>
              🔐 Unlock with Face ID / fingerprint
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
