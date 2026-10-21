import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const originalFetch = globalThis.fetch;
const sent = [];
let deliveryFails = false;
globalThis.fetch = async (input, init) => {
  if (String(input) === 'https://api.resend.com/emails') {
    sent.push(JSON.parse(init.body));
    if (deliveryFails) return new Response(JSON.stringify({ message: 'temporary failure' }), { status: 503 });
    return new Response(JSON.stringify({ id: 'email-test' }), { status: 200,
      headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};

process.env.NODE_ENV = 'production';
process.env.RESEND_API_KEY = 're_test_key';
process.env.EMAIL_FROM = 'Gym Buddy <hello@example.com>';
process.env.PUBLIC_APP_URL = 'https://gym-buddy.example.com/';
process.env.ALLOW_PILOT_AUTH = 'false';
process.env.ILLINOIS_OIDC_ISSUER = '';
process.env.ILLINOIS_OIDC_CLIENT_ID = '';
process.env.ILLINOIS_OIDC_CLIENT_SECRET = '';
process.env.ILLINOIS_OIDC_REDIRECT_URI = '';
const dataDir = mkdtempSync(path.join(tmpdir(), 'gym-buddy-email-auth-'));
process.env.DATA_DIR = dataDir;
const { app, db } = await import('./index.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  globalThis.fetch = originalFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

async function request(endpoint, body, cookie) {
  const response = await originalFetch(`${base}${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

function tokenFromLastEmail(kind) {
  const match = new RegExp(`#${kind}=([A-Za-z0-9_-]{43})`).exec(sent.at(-1)?.text || '');
  assert.ok(match, `Email contains a ${kind} link`);
  return match[1];
}

test('verified email sign-up gates social access, rejects pilot identities, and resets password', async () => {
  const config = await request('/api/auth/netid/config');
  assert.deepEqual(config.body, { enabled: false, pilotAuthEnabled: false, emailAuthEnabled: true });
  assert.equal((await request('/api/auth/register', {
    name: 'Pilot', email: 'pilot@illinois.edu', password: 'oldpassword',
  })).status, 403);

  const registered = await request('/api/auth/email/register', {
    name: 'Taylor Example', email: 'taylor@example.org', password: 'long-unique-password',
  });
  assert.equal(registered.status, 202);
  assert.equal(registered.body.verificationRequired, true);
  assert.equal(registered.cookie, undefined);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /https:\/\/gym-buddy\.example\.com\/#verify=/);

  const before = await request('/api/auth/email/login', {
    email: 'taylor@example.org', password: 'long-unique-password',
  });
  assert.equal(before.status, 403);
  assert.equal(before.cookie, undefined);
  const pendingUser = db.prepare('SELECT id FROM users WHERE email = ?').get('taylor@example.org');
  assert.equal(db.prepare('SELECT verified_at FROM email_identities WHERE user_id = ?').get(pendingUser.id).verified_at, null);

  const bad = await request('/api/auth/email/verify', { token: randomBytes(32).toString('base64url') });
  assert.equal(bad.status, 400);
  const token = tokenFromLastEmail('verify');
  const verified = await request('/api/auth/email/verify', { token });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.email, 'taylor@example.org');
  assert.ok(verified.cookie);
  assert.equal((await request('/api/me', undefined, verified.cookie)).status, 200);
  assert.equal((await request('/api/auth/email/verify', { token })).status, 400);
  assert.equal((await request('/api/auth/email/login', {
    email: 'taylor@example.org', password: 'wrong-password',
  })).status, 401);

  const pilot = db.prepare(`INSERT INTO users (name, email, password_hash, password_salt, created_at)
    VALUES ('Old Pilot', 'pilot@illinois.edu', 'unused', 'unused', ?)`).run(new Date().toISOString());
  const pilotToken = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(createHash('sha256').update(pilotToken).digest('hex'), pilot.lastInsertRowid,
      Date.now() + 60_000, Date.now());
  assert.equal((await request('/api/me', undefined, `uiuc_gym_buddy_session=${pilotToken}`)).status, 401);
  assert.deepEqual((await request('/api/matches', undefined, verified.cookie)).body, { matches: [] });
  assert.equal((await request('/api/auth/email/register', {
    name: 'Old Pilot', email: 'pilot@illinois.edu', password: 'long-unique-password',
  })).status, 409);

  const unknownReset = await request('/api/auth/email/reset/request', { email: 'unknown@example.org' });
  assert.equal(unknownReset.status, 200);
  assert.equal(sent.length, 1);
  const resetRequest = await request('/api/auth/email/reset/request', { email: 'taylor@example.org' });
  assert.equal(resetRequest.status, 200);
  assert.equal(sent.length, 2);
  const resetToken = tokenFromLastEmail('reset');
  const resetComplete = await request('/api/auth/email/reset/complete', {
    token: resetToken, password: 'new-unique-password',
  }, verified.cookie);
  assert.equal(resetComplete.status, 200);
  assert.equal(resetComplete.cookie, 'uiuc_gym_buddy_session=');
  assert.equal((await request('/api/auth/email/reset/complete', {
    token: resetToken, password: 'another-unique-password',
  })).status, 400);
  assert.equal((await request('/api/me', undefined, verified.cookie)).status, 401);
  assert.equal((await request('/api/auth/email/login', {
    email: 'taylor@example.org', password: 'long-unique-password',
  })).status, 401);
  const newLogin = await request('/api/auth/email/login', {
    email: 'taylor@example.org', password: 'new-unique-password',
  });
  assert.equal(newLogin.status, 200);
  assert.ok(newLogin.cookie);
});

test('verification resend keeps prior unexpired links and returns the same response for unknown addresses', async () => {
  assert.equal((await request('/api/auth/email/register', {
    name: 'Sam Example', email: 'sam@example.org', password: 'another-long-password',
  })).status, 202);
  const first = tokenFromLastEmail('verify');
  const unknown = await request('/api/auth/email/resend', { email: 'nobody@example.org' });
  const resend = await request('/api/auth/email/resend', { email: 'sam@example.org' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(resend.body, unknown.body);
  const second = tokenFromLastEmail('verify');
  assert.notEqual(second, first);
  assert.equal((await request('/api/auth/email/verify', { token: first })).status, 200);
  assert.equal((await request('/api/auth/email/verify', { token: second })).status, 400);
});

test('failed resend and reset delivery leave earlier emailed links usable', async () => {
  assert.equal((await request('/api/auth/email/register', {
    name: 'Morgan Example', email: 'morgan@example.org', password: 'more-long-password',
  })).status, 202);
  const initialVerify = tokenFromLastEmail('verify');
  deliveryFails = true;
  const resend = await request('/api/auth/email/resend', { email: 'morgan@example.org' });
  const failedVerify = tokenFromLastEmail('verify');
  deliveryFails = false;
  assert.equal(resend.status, 200);
  assert.equal((await request('/api/auth/email/verify', { token: failedVerify })).status, 400);
  assert.equal((await request('/api/auth/email/verify', { token: initialVerify })).status, 200);

  assert.equal((await request('/api/auth/email/reset/request', { email: 'morgan@example.org' })).status, 200);
  const initialReset = tokenFromLastEmail('reset');
  deliveryFails = true;
  const resetRequest = await request('/api/auth/email/reset/request', { email: 'morgan@example.org' });
  const failedReset = tokenFromLastEmail('reset');
  deliveryFails = false;
  assert.equal(resetRequest.status, 200);
  assert.equal((await request('/api/auth/email/reset/complete', {
    token: failedReset, password: 'new-morgan-password',
  })).status, 400);
  assert.equal((await request('/api/auth/email/reset/complete', {
    token: initialReset, password: 'new-morgan-password',
  })).status, 200);
});
