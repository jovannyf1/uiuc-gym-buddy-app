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
process.env.ALLOW_PILOT_AUTH = 'true';
process.env.ILLINOIS_OIDC_ISSUER = 'https://identity.example.org';
process.env.ILLINOIS_OIDC_CLIENT_ID = 'unused-client';
process.env.ILLINOIS_OIDC_CLIENT_SECRET = 'unused-secret';
process.env.ILLINOIS_OIDC_REDIRECT_URI = 'https://gym-buddy.example.com/api/auth/netid/callback';
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

test('new email account can sign in before verification, excludes pilot identities, and resets after verification', async () => {
  const config = await request('/api/auth/config');
  assert.deepEqual(config.body, { pilotAuthEnabled: false, emailAuthEnabled: true });
  assert.equal((await request('/api/auth/netid/config')).status, 404);
  assert.equal((await request('/api/auth/netid/start')).status, 404);
  assert.equal((await request('/api/auth/register', {
    name: 'Pilot', email: 'pilot@illinois.edu', password: 'oldpassword',
  })).status, 403);
  assert.equal((await request('/api/auth/login', {
    email: 'pilot@illinois.edu', password: 'oldpassword',
  })).status, 403);
  assert.equal((await request('/api/auth/email/verify/send', {})).status, 401);

  const registered = await request('/api/auth/email/register', {
    name: 'Taylor Example', email: 'taylor@example.org', password: 'long-unique-password',
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.emailVerified, false);
  assert.ok(registered.cookie, 'registration starts a session');
  assert.equal(sent.length, 0, 'registration does not depend on email delivery');

  const before = await request('/api/auth/email/login', {
    email: 'taylor@example.org', password: 'long-unique-password',
  });
  assert.equal(before.status, 200);
  assert.equal(before.body.user.emailVerified, false);
  assert.ok(before.cookie);
  const pendingMe = await request('/api/me', undefined, registered.cookie);
  assert.equal(pendingMe.status, 200);
  assert.equal(pendingMe.body.user.emailVerified, false);
  assert.equal((await request('/api/availability', undefined, registered.cookie)).status, 200);
  const pendingUser = db.prepare('SELECT id FROM users WHERE email = ?').get('taylor@example.org');
  assert.equal(db.prepare('SELECT verified_at FROM email_identities WHERE user_id = ?').get(pendingUser.id).verified_at, null);
  assert.equal((await request('/api/auth/email/reset/request', { email: 'taylor@example.org' })).status, 200);
  assert.equal(sent.length, 0, 'password reset does not send to an unverified address');

  const sendVerification = await request('/api/auth/email/verify/send', {}, registered.cookie);
  assert.equal(sendVerification.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /https:\/\/gym-buddy\.example\.com\/#verify=/);

  const bad = await request('/api/auth/email/verify', { token: randomBytes(32).toString('base64url') });
  assert.equal(bad.status, 400);
  const token = tokenFromLastEmail('verify');
  const verified = await request('/api/auth/email/verify', { token });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.email, 'taylor@example.org');
  assert.equal(verified.body.user.emailVerified, true);
  assert.ok(verified.cookie);
  assert.equal((await request('/api/me', undefined, verified.cookie)).body.user.emailVerified, true);
  assert.equal((await request('/api/auth/email/verify/send', {}, verified.cookie)).body.emailVerified, true);
  assert.equal(sent.length, 1, 'already verified members do not receive another email');
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
  const registered = await request('/api/auth/email/register', {
    name: 'Sam Example', email: 'sam@example.org', password: 'another-long-password',
  });
  assert.equal(registered.status, 201);
  assert.equal((await request('/api/auth/email/verify/send', {}, registered.cookie)).status, 200);
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

test('failed optional verification and reset delivery leave earlier emailed links usable', async () => {
  const registered = await request('/api/auth/email/register', {
    name: 'Morgan Example', email: 'morgan@example.org', password: 'more-long-password',
  });
  assert.equal(registered.status, 201);
  assert.equal((await request('/api/auth/email/verify/send', {}, registered.cookie)).status, 200);
  const initialVerify = tokenFromLastEmail('verify');
  deliveryFails = true;
  const resend = await request('/api/auth/email/verify/send', {}, registered.cookie);
  const failedVerify = tokenFromLastEmail('verify');
  deliveryFails = false;
  assert.equal(resend.status, 503);
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
