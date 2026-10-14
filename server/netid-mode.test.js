import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'production';
process.env.ALLOW_PILOT_AUTH = 'false';
process.env.ILLINOIS_OIDC_ISSUER = '';
process.env.ILLINOIS_OIDC_CLIENT_ID = '';
process.env.ILLINOIS_OIDC_CLIENT_SECRET = '';
process.env.ILLINOIS_OIDC_REDIRECT_URI = '';
const dataDir = mkdtempSync(path.join(tmpdir(), 'gym-buddy-netid-mode-'));
process.env.DATA_DIR = dataDir;
const { app, db } = await import('./index.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function student(name, number, linked) {
  const inserted = db.prepare(`INSERT INTO users
    (name, email, password_hash, password_salt, created_at)
    VALUES (?, ?, 'unused', 'unused', ?)`).run(name, `student${number}@illinois.edu`, new Date().toISOString());
  const id = Number(inserted.lastInsertRowid);
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), id, Date.now() + 60_000, Date.now());
  if (linked) {
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

test('production fails closed for old pilot sessions without exposing legacy matches or meetups', async () => {
  const currentStudent = student('Current Student', 1, true);
  const pilotAccount = student('Pilot Account', 2, false);
  db.prepare('INSERT INTO availability (user_id, day, start, end) VALUES (?, 0, ?, ?)')
    .run(pilotAccount.id, '17:00', '18:00');

  assert.equal((await request(pilotAccount, '/api/me')).status, 401);
  assert.deepEqual((await request(currentStudent, '/api/matches')).body, { matches: [] });
  const meetup = db.prepare(`INSERT INTO meetups
    (from_user_id, to_user_id, activity, date, day, start, end, location, status, created_at)
    VALUES (?, ?, 'Strength training', '2099-01-01', 0, '17:00', '18:00', 'ARC', 'pending', ?)`)
    .run(currentStudent.id, pilotAccount.id, new Date().toISOString());
  assert.deepEqual((await request(currentStudent, '/api/meetups')).body, { meetups: [] });
  assert.equal((await request(currentStudent, `/api/meetups/${meetup.lastInsertRowid}`, {
    method: 'PATCH', body: { status: 'cancelled' },
  })).status, 404);
});
