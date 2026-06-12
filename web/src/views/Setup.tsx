import { useState } from 'react';
import { api } from '../api';
import LeafRain from '../components/LeafRain';

export default function Setup({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await api.post('/api/setup', { username, password });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <LeafRain />
      <div className="auth-card card">
        <img className="mark" src="/icons/icon.svg" alt="Dayleaf" />
        <h1>Welcome to Dayleaf</h1>
        <p className="tagline">Your days, one leaf at a time. Set up your private journal.</p>
        <form onSubmit={submit}>
          <label className="field">
            Your name
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          </label>
          <label className="field">
            Password (8+ characters)
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          </label>
          <label className="field">
            Confirm password
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn primary" disabled={busy}>Create my journal</button>
        </form>
      </div>
    </div>
  );
}
