import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'gym-buddy-social-'));
process.env.DATA_DIR = dataDir;
const { app, db } = await import('./index.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function student(name, number, { gender = 'female', preference = 'any',
  activities = ['Strength training'], locations = ['ARC'] } = {}) {
  const result = db.prepare(`INSERT INTO users
    (name, email, password_hash, password_salt, gender, partner_preference,
      activities, locations, created_at)
    VALUES (?, ?, 'unused', 'unused', ?, ?, ?, ?, ?)`)
    .run(name, `student${number}@illinois.edu`, gender, preference,
      JSON.stringify(activities), JSON.stringify(locations), new Date().toISOString());
  const userId = Number(result.lastInsertRowid);
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)`).run(hash, userId, now + 60_000, now);
  return { id: userId, cookie: `uiuc_gym_buddy_session=${token}` };
}

async function request(user, endpoint, { method = 'GET', body } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: {
      cookie: user.cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const alice = student('Alice', 1);
const bob = student('Bob', 2, { gender: 'male' });
const carol = student('Carol', 3, { locations: ['CRCE'] });

test('presence is opt-in, expires, and reveals only compatible students at a chosen gym', async () => {
  assert.equal((await fetch(`${base}/api/presence/nearby`)).status, 401);
  assert.deepEqual((await request(alice, '/api/presence/me')).body, { presence: null });
  assert.deepEqual((await request(alice, '/api/presence/nearby')).body, { people: [] });
  assert.equal((await request(bob, '/api/presence', {
    method: 'PUT', body: { activity: 'Strength training', location: 'ARC', durationMinutes: 60 },
  })).status, 200);
  assert.equal((await request(carol, '/api/presence', {
    method: 'PUT', body: { activity: 'Strength training', location: 'CRCE' },
  })).status, 200);
  const nearby = (await request(alice, '/api/presence/nearby')).body.people;
  assert.equal(nearby.length, 1);
  assert.equal(nearby[0].user.id, bob.id);
  assert.equal(nearby[0].location, 'ARC');
  assert.equal(nearby[0].activity, 'Strength training');
  assert.equal('email' in nearby[0].user, false);
  assert.equal('partnerPreference' in nearby[0].user, false);
  assert.equal((await request(bob, '/api/presence', {
    method: 'PUT', body: { activity: 'Cardio', location: 'ARC' },
  })).status, 400);
  assert.equal((await request(bob, '/api/presence', {
    method: 'PUT', body: { activity: 'Strength training', location: 'ARC', durationMinutes: 181 },
  })).status, 400);
  db.prepare('UPDATE workout_presence SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1, bob.id);
  assert.deepEqual((await request(bob, '/api/presence/me')).body, { presence: null });
  assert.deepEqual((await request(alice, '/api/presence/nearby')).body, { people: [] });
  assert.deepEqual((await request(carol, '/api/presence', { method: 'DELETE' })).body, { ok: true });
});

test('chats require compatible users, protect messages, and limit rapid sends', async () => {
  const incompatible = await request(alice, '/api/chats', {
    method: 'POST', body: { toUserId: carol.id },
  });
  assert.equal(incompatible.status, 403);
  const created = await request(alice, '/api/chats', {
    method: 'POST', body: { toUserId: bob.id },
  });
  assert.equal(created.status, 201);
  const chatId = created.body.chat.id;
  assert.equal(created.body.chat.otherUser.id, bob.id);
  assert.equal(created.body.chat.lastMessage, null);
  assert.equal((await request(alice, '/api/chats', {
    method: 'POST', body: { toUserId: bob.id },
  })).body.chat.id, chatId);
  assert.equal((await request(carol, `/api/chats/${chatId}/messages`)).status, 404);
  assert.equal((await request(carol, `/api/chats/${chatId}/messages`, {
    method: 'POST', body: { text: 'Intrusion' },
  })).status, 404);
  assert.equal((await request(bob, `/api/chats/${chatId}/messages`, {
    method: 'POST', body: { text: 'Forged', senderUserId: alice.id },
  })).status, 400);
  const sent = await request(bob, `/api/chats/${chatId}/messages`, {
    method: 'POST', body: { text: '  Meet at ARC?  ' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.text, 'Meet at ARC?');
  assert.equal(sent.body.message.senderUserId, bob.id);
  assert.equal((await request(alice, `/api/chats/${chatId}/messages`)).body.messages[0].text,
    'Meet at ARC?');
  assert.equal((await request(bob, `/api/chats/${chatId}/messages`, {
    method: 'POST', body: { text: 'Too soon' },
  })).status, 429);
  assert.equal((await request(bob, `/api/chats/${chatId}/messages`, {
    method: 'POST', body: { text: 'x'.repeat(1001) },
  })).status, 400);
  assert.equal((await request(alice, '/api/chats')).body.chats[0].lastMessage.text, 'Meet at ARC?');
});

test('blocking suppresses discovery and contact; reports are persisted and rate limited', async () => {
  await request(alice, '/api/availability', {
    method: 'PUT', body: { slots: [{ day: 0, start: '17:00', end: '18:00' }] },
  });
  await request(bob, '/api/availability', {
    method: 'PUT', body: { slots: [{ day: 0, start: '17:00', end: '18:00' }] },
  });
  assert.equal((await request(alice, '/api/matches')).body.matches[0].user.id, bob.id);
  await request(bob, '/api/presence', {
    method: 'PUT', body: { activity: 'Strength training', location: 'ARC' },
  });
  const meetup = db.prepare(`INSERT INTO meetups
    (from_user_id, to_user_id, activity, date, day, start, end, location, status, created_at)
    VALUES (?, ?, 'Strength training', '2099-01-01', 0, '17:00', '18:00', 'ARC', 'pending', ?)`)
    .run(alice.id, bob.id, new Date().toISOString());
  const block = await request(alice, `/api/users/${bob.id}/block`, { method: 'POST' });
  assert.deepEqual(block.body, { blocked: true });
  assert.equal((await request(alice, '/api/blocks')).body.blockedUsers[0].id, bob.id);
  assert.equal(db.prepare('SELECT status FROM meetups WHERE id = ?').get(meetup.lastInsertRowid).status,
    'cancelled');
  assert.deepEqual((await request(alice, '/api/presence/nearby')).body, { people: [] });
  assert.deepEqual((await request(alice, '/api/matches')).body, { matches: [] });
  assert.deepEqual((await request(alice, '/api/chats')).body, { chats: [] });
  assert.equal((await request(alice, '/api/meetups', {
    method: 'POST', body: { toUserId: bob.id },
  })).status, 403);
  assert.equal((await request(bob, '/api/chats', {
    method: 'POST', body: { toUserId: alice.id },
  })).status, 403);
  const chatId = db.prepare('SELECT id FROM chats WHERE user_a_id = ? AND user_b_id = ?')
    .get(alice.id, bob.id).id;
  assert.equal((await request(bob, `/api/chats/${chatId}/messages`, {
    method: 'POST', body: { text: 'No contact' },
  })).status, 403);
  assert.equal((await request(bob, `/api/chats/${chatId}/messages`)).body.messages.length, 1);
  const report = await request(alice, `/api/users/${bob.id}/report`, {
    method: 'POST', body: { reason: 'harassment', details: 'Unwanted messages' },
  });
  assert.equal(report.status, 201);
  assert.equal(db.prepare('SELECT reason FROM user_reports WHERE reported_user_id = ?')
    .get(bob.id).reason, 'harassment');
  assert.equal((await request(alice, `/api/users/${bob.id}/report`, {
    method: 'POST', body: { reason: 'spam' },
  })).status, 429);
  assert.deepEqual((await request(alice, `/api/users/${bob.id}/block`, {
    method: 'DELETE',
  })).body, { blocked: false });
  assert.deepEqual((await request(alice, '/api/blocks')).body, { blockedUsers: [] });
  assert.equal((await request(alice, '/api/presence/nearby')).body.people[0].user.id, bob.id);
});
