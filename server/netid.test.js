import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { createNetidStartLimiter, netidEmailFromClaims, pkceChallenge, registerNetidRoutes } from './netid.js';

test('NetID identity accepts only an Illinois address from verified provider claims', () => {
  assert.equal(netidEmailFromClaims({ preferred_username: 'Student@Illinois.edu' }), 'student@illinois.edu');
  assert.equal(netidEmailFromClaims({ preferred_username: 'student@uic.edu', email: 'student@illinois.edu' }), null);
  assert.equal(netidEmailFromClaims({ email: 'student@illinois.edu', email_verified: true }), 'student@illinois.edu');
  assert.equal(netidEmailFromClaims({ preferred_username: 'student@example.com' }), null);
});

test('NetID start limiter blocks repeated unauthenticated starts and resets after its window', () => {
  const limit = createNetidStartLimiter();
  for (let index = 0; index < 10; index += 1) limit('127.0.0.1', 1_000);
  assert.throws(() => limit('127.0.0.1', 1_001), { status: 429 });
  assert.doesNotThrow(() => limit('127.0.0.1', 1_000 + 15 * 60 * 1000));
});

test('native sign-in ticket requires matching PKCE proof and can only be used once', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);`);
  db.prepare('INSERT INTO users (id, name, email) VALUES (1, ?, ?)').run('Test Student', 'student@illinois.edu');
  const app = express();
  app.use(express.json());
  registerNetidRoutes({
    app, db,
    createSession: (_req, res) => res.set('X-Session-Created', 'yes'),
    profile: user => ({ id: user.id, name: user.name, email: user.email }),
  });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const verifier = randomBytes(32).toString('base64url');
    const code = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO netid_native_tickets (ticket_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)')
      .run(createHash('sha256').update(code).digest('hex'), 1, pkceChallenge(verifier), Date.now() + 30_000);
    const exchange = proof => fetch(`${base}/api/auth/netid/native/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier: proof }),
    });
    assert.equal((await exchange(randomBytes(32).toString('base64url'))).status, 401);
    const success = await exchange(verifier);
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('x-session-created'), 'yes');
    assert.deepEqual((await success.json()).user, { id: 1, name: 'Test Student', email: 'student@illinois.edu' });
    assert.equal((await exchange(verifier)).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
