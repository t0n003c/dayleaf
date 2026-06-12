import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { db } from './db.js';

// WebAuthn (passkeys) powers biometric sign-in: Face ID / Touch ID / fingerprint.
// The RP ID must match the hostname the app is served from, so we derive it per
// request — this lets the same container work on any NAS hostname or domain.

const challenges = new Map(); // purpose -> challenge (single-user app)

export function rpFromRequest(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const rpID = String(host).split(',')[0].trim().replace(/:\d+$/, '');
  const origin = `${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`;
  return { rpID, origin };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export async function registrationOptions(req, user) {
  const { rpID } = rpFromRequest(req);
  const existing = db.prepare('SELECT id, transports FROM credentials WHERE user_id = ?').all(user.id);
  const options = await generateRegistrationOptions({
    rpName: 'Dayleaf',
    rpID,
    userID: String(user.id),
    userName: user.username,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: Buffer.from(c.id, 'base64url'),
      type: 'public-key',
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: {
      // 'platform' asks for the device's built-in biometric (Face ID, Touch ID,
      // fingerprint, Windows Hello) instead of password-manager extensions or
      // roaming security keys.
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });
  challenges.set('register', options.challenge);
  return options;
}

export async function verifyRegistration(req, user, body) {
  const { rpID, origin } = rpFromRequest(req);
  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: challenges.get('register'),
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  challenges.delete('register');
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration could not be verified');
  }
  const info = verification.registrationInfo;
  db.prepare(
    'INSERT OR REPLACE INTO credentials (id, user_id, public_key, counter, transports, nickname) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    b64url(info.credentialID),
    user.id,
    Buffer.from(info.credentialPublicKey),
    info.counter,
    JSON.stringify(body.response?.response?.transports || []),
    body.nickname || 'Passkey'
  );
  return true;
}

export async function authenticationOptions(req) {
  const { rpID } = rpFromRequest(req);
  const creds = db.prepare('SELECT id, transports FROM credentials').all();
  if (creds.length === 0) throw new Error('No passkeys registered');
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({
      id: Buffer.from(c.id, 'base64url'),
      type: 'public-key',
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
  });
  challenges.set('auth', options.challenge);
  return options;
}

export async function verifyAuthentication(req, body) {
  const { rpID, origin } = rpFromRequest(req);
  const cred = db.prepare('SELECT * FROM credentials WHERE id = ?').get(body.response?.id);
  if (!cred) throw new Error('Unknown passkey');
  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: challenges.get('auth'),
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: Buffer.from(cred.id, 'base64url'),
      credentialPublicKey: cred.public_key,
      counter: cred.counter,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    },
  });
  challenges.delete('auth');
  if (!verification.verified) throw new Error('Passkey sign-in could not be verified');
  db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(
    verification.authenticationInfo.newCounter, cred.id
  );
  return cred.user_id;
}

export function listCredentials() {
  return db.prepare('SELECT id, nickname, created_at FROM credentials').all();
}

export function deleteCredential(id) {
  db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
}
