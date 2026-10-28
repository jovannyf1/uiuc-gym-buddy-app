import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chicagoNow } from './core.js';

const dataDir = mkdtempSync(path.join(tmpdir(), 'gym-buddy-first-run-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'production';
process.env.ALLOW_PILOT_AUTH = 'false';
process.env.ILLINOIS_OIDC_ISSUER = '';
process.env.ILLINOIS_OIDC_CLIENT_ID = '';
process.env.ILLINOIS_OIDC_CLIENT_SECRET = '';
process.env.ILLINOIS_OIDC_REDIRECT_URI = '';
process.env.RESEND_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'Illini Workout Buddy <test@example.com>';
process.env.PUBLIC_APP_URL = 'http://127.0.0.1:5174/';

const actualFetch = globalThis.fetch;
const sentEmails = [];
globalThis.fetch = async (url, options) => {
  if (String(url) === 'https://api.resend.com/emails') {
    sentEmails.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: `test-${sentEmails.length}` }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return actualFetch(url, options);
};

const { app, db } = await import('./index.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let closed = false;

after(async () => {
  if (!closed) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
  globalThis.fetch = actualFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

async function request(endpoint, { method = 'GET', cookie, body } = {}) {
  const response = await actualFetch(`${base}${endpoint}`, {
    method,
    headers: {
      origin: base,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function emailStudent(name, email) {
  const registered = await request('/api/auth/email/register', {
    method: 'POST', body: { name, email, password: 'first-run-test-password' },
  });
  assert.equal(registered.status, 201);
  assert.ok(registered.cookie, 'registration starts a session');
  assert.equal(registered.body.user.emailVerified, false);
  assert.equal(sentEmails.length, 0, 'joining the app does not depend on email delivery');
  return { id: registered.body.user.id, cookie: registered.cookie };
}

test('two new email students can match, chat, meet, and persist data before verifying', async () => {
  const alice = await emailStudent('Alice Test', 'alice@example.com');
  const bob = await emailStudent('Bob Test', 'bob@example.com');
  const profile = {
    activities: ['Strength training'], locations: ['ARC'],
    experience: 'beginner', bio: 'Looking for a weekday gym buddy.',
  };
  for (const student of [alice, bob]) {
    const updated = await request('/api/me', { method: 'PATCH', cookie: student.cookie, body: profile });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.emailVerified, false);
  }
  assert.equal((await request('/api/availability', {
    method: 'PUT', cookie: alice.cookie,
    body: { slots: [{ day: 0, start: '17:00', end: '18:30' }] },
  })).status, 200);
  assert.equal((await request('/api/availability', {
    method: 'PUT', cookie: bob.cookie,
    body: { slots: [{ day: 1, start: '17:30', end: '18:30' }] },
  })).status, 200);
  assert.deepEqual((await request('/api/matches', { cookie: alice.cookie })).body.matches, [],
    'Students free on different days should not match');

  assert.equal((await request('/api/availability', {
    method: 'PUT', cookie: bob.cookie,
    body: { slots: [{ day: 0, start: '17:30', end: '18:30' }] },
  })).status, 200);

  const matches = await request('/api/matches', { cookie: alice.cookie });
  assert.equal(matches.status, 200);
  assert.equal(matches.body.matches.length, 1);
  assert.equal(matches.body.matches[0].user.id, bob.id);
  assert.deepEqual(matches.body.matches[0].overlaps,
    [{ day: 0, start: '17:30', end: '18:30' }]);
  assert.equal('email' in matches.body.matches[0].user, false);

  const started = await request('/api/chats', {
    method: 'POST', cookie: alice.cookie, body: { toUserId: bob.id },
  });
  assert.equal(started.status, 201);
  const chatId = started.body.chat.id;
  const sent = await request(`/api/chats/${chatId}/messages`, {
    method: 'POST', cookie: alice.cookie, body: { text: 'Want to meet at ARC on Monday?' },
  });
  assert.equal(sent.status, 201);
  const inbox = await request(`/api/chats/${chatId}/messages`, { cookie: bob.cookie });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.messages[0].text, 'Want to meet at ARC on Monday?');

  const nextMonday = new Date(`${chicagoNow().date}T12:00:00Z`);
  const today = (nextMonday.getUTCDay() + 6) % 7;
  nextMonday.setUTCDate(nextMonday.getUTCDate() + (7 - today));
  const date = nextMonday.toISOString().slice(0, 10);
  const invite = await request('/api/meetups', {
    method: 'POST', cookie: alice.cookie,
    body: {
      toUserId: bob.id, activity: 'Strength training', location: 'ARC',
      date, day: 0, start: '17:30', end: '18:00', note: 'Meet at the entrance',
    },
  });
  assert.equal(invite.status, 201);
  assert.equal(invite.body.meetup.status, 'pending');
  const meetupId = invite.body.meetup.id;
  assert.equal((await request(`/api/meetups/${meetupId}`, {
    method: 'PATCH', cookie: bob.cookie, body: { status: 'accepted' },
  })).body.meetup.status, 'accepted');
  assert.equal((await request('/api/meetups', { cookie: alice.cookie })).body.meetups[0].status,
    'accepted');
  assert.equal((await request('/api/meetups', { cookie: bob.cookie })).body.meetups[0].status,
    'accepted');

  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  closed = true;
  const saved = new DatabaseSync(path.join(dataDir, 'app.db'));
  try {
    assert.equal(saved.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
    assert.equal(saved.prepare('SELECT COUNT(*) AS count FROM availability').get().count, 2);
    assert.equal(saved.prepare('SELECT body FROM chat_messages WHERE chat_id = ?').get(chatId).body,
      'Want to meet at ARC on Monday?');
    assert.equal(saved.prepare('SELECT status FROM meetups WHERE id = ?').get(meetupId).status,
      'accepted');
  } finally { saved.close(); }
});
