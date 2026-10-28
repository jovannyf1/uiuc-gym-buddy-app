import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'production';
process.env.ALLOW_PILOT_AUTH = 'true';
process.env.ILLINOIS_OIDC_ISSUER = '';
process.env.ILLINOIS_OIDC_CLIENT_ID = '';
process.env.ILLINOIS_OIDC_CLIENT_SECRET = '';
process.env.ILLINOIS_OIDC_REDIRECT_URI = '';
const dataDir = mkdtempSync(path.join(tmpdir(), 'gym-buddy-email-only-mode-'));
process.env.DATA_DIR = dataDir;
const { app, db } = await import('./index.js');
// Existing databases may still contain an identity created by an earlier
// NetID-capable version. It must not grant access in the email-only launch.
db.exec(`CREATE TABLE netid_identities (
  subject TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
)`);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function student(name, number, identity) {
  const inserted = db.prepare(`INSERT INTO users
    (name, email, password_hash, password_salt, activities, locations, created_at)
    VALUES (?, ?, 'unused', 'unused', ?, ?, ?)`).run(name, `student${number}@example.org`,
      JSON.stringify(['Strength training']), JSON.stringify(['ARC']), new Date().toISOString());
  const id = Number(inserted.lastInsertRowid);
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), id, Date.now() + 60_000, Date.now());
  if (identity === 'email' || identity === 'pending') {
    db.prepare('INSERT INTO email_identities (user_id, verified_at, created_at) VALUES (?, ?, ?)')
      .run(id, identity === 'email' ? Date.now() : null, Date.now());
  } else if (identity === 'netid') {
    db.prepare('INSERT INTO netid_identities (subject, user_id, created_at) VALUES (?, ?, ?)')
      .run(`issuer\u0000student${number}`, id, Date.now());
  }
  return { id, cookie: `uiuc_gym_buddy_session=${token}` };
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

test('production permits unverified email identities but excludes pilot and NetID-only users', async () => {
  const currentStudent = student('Current Student', 1, 'pending');
  const verifiedFriend = student('Verified Friend', 2, 'email');
  const pendingFriend = student('Pending Friend', 5, 'pending');
  const pilotAccount = student('Pilot Account', 3, null);
  const oldNetidAccount = student('Old NetID Account', 4, 'netid');
  const addSlot = db.prepare('INSERT INTO availability (user_id, day, start, "end") VALUES (?, 0, ?, ?)');
  for (const person of [currentStudent, verifiedFriend, pendingFriend, pilotAccount, oldNetidAccount]) {
    addSlot.run(person.id, '17:00', '18:00');
  }

  assert.deepEqual((await request(currentStudent, '/api/auth/config')).body,
    { emailAuthEnabled: false, pilotAuthEnabled: false });
  assert.equal((await request(currentStudent, '/api/auth/register', {
    method: 'POST', body: { name: 'New Account', email: 'new@illinois.edu', password: 'oldpassword' },
  })).status, 403);
  assert.equal((await request(currentStudent, '/api/auth/login', {
    method: 'POST', body: { email: 'student3@example.org', password: 'oldpassword' },
  })).status, 403);
  assert.equal((await request(pilotAccount, '/api/me')).status, 401);
  assert.equal((await request(oldNetidAccount, '/api/me')).status, 401);
  assert.equal((await request(currentStudent, '/api/me')).body.user.emailVerified, false);
  const matches = await request(currentStudent, '/api/matches');
  assert.deepEqual(matches.body.matches.map(match => match.user.id).sort((a, b) => a - b),
    [verifiedFriend.id, pendingFriend.id].sort((a, b) => a - b));

  const now = Date.now();
  const addPresence = db.prepare(`INSERT INTO workout_presence
    (user_id, activity, location, expires_at, updated_at) VALUES (?, 'Strength training', 'ARC', ?, ?)`);
  for (const person of [verifiedFriend, pendingFriend, pilotAccount, oldNetidAccount]) {
    addPresence.run(person.id, now + 60_000, now);
  }
  const nearby = await request(currentStudent, '/api/presence/nearby');
  assert.deepEqual(nearby.body.people.map(person => person.user.id).sort((a, b) => a - b),
    [verifiedFriend.id, pendingFriend.id].sort((a, b) => a - b));

  const addMeetup = db.prepare(`INSERT INTO meetups
    (from_user_id, to_user_id, activity, date, day, start, "end", location, status, created_at)
    VALUES (?, ?, 'Strength training', '2099-01-01', 0, '17:00', '18:00', 'ARC', 'pending', ?)`)
  const goodMeetup = addMeetup.run(currentStudent.id, verifiedFriend.id, new Date().toISOString());
  const pendingMeetup = addMeetup.run(currentStudent.id, pendingFriend.id, new Date().toISOString());
  const oldPilotMeetup = addMeetup.run(currentStudent.id, pilotAccount.id, new Date().toISOString());
  const oldNetidMeetup = addMeetup.run(currentStudent.id, oldNetidAccount.id, new Date().toISOString());
  const meetups = await request(currentStudent, '/api/meetups');
  assert.deepEqual(meetups.body.meetups.map(meetup => meetup.id).sort((a, b) => a - b),
    [goodMeetup.lastInsertRowid, pendingMeetup.lastInsertRowid].sort((a, b) => a - b));
  for (const meetup of [oldPilotMeetup, oldNetidMeetup]) {
    assert.equal((await request(currentStudent, `/api/meetups/${meetup.lastInsertRowid}`, {
    method: 'PATCH', body: { status: 'cancelled' },
    })).status, 404);
  }

  const addChat = db.prepare(`INSERT INTO chats
    (user_a_id, user_b_id, initiated_by_user_id, created_at, created_at_ms, updated_at, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const person of [verifiedFriend, pendingFriend, pilotAccount, oldNetidAccount]) {
    addChat.run(currentStudent.id, person.id, currentStudent.id,
      new Date(now).toISOString(), now, new Date(now).toISOString(), now);
  }
  const chats = await request(currentStudent, '/api/chats');
  assert.deepEqual(chats.body.chats.map(chat => chat.otherUser.id).sort((a, b) => a - b),
    [verifiedFriend.id, pendingFriend.id].sort((a, b) => a - b));
});
