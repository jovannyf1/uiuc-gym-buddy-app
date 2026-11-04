import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chicagoNow, weekdayForDate } from './core.js';

const dataDir = mkdtempSync(path.join(tmpdir(), 'gym-buddy-meetup-race-'));
process.env.DATA_DIR = dataDir;
const { app, db } = await import('./index.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function student(name) {
  const result = db.prepare(`INSERT INTO users
    (name, email, password_hash, password_salt, activities, locations, created_at)
    VALUES (?, ?, 'unused', 'unused', '["Strength training"]', '["ARC"]', ?)`)
    .run(name, `${name.toLowerCase()}-${randomBytes(4).toString('hex')}@example.com`, new Date().toISOString());
  const id = Number(result.lastInsertRowid);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(createHash('sha256').update(token).digest('hex'), id, now + 60_000, now);
  for (let day = 0; day < 7; day += 1) {
    db.prepare('INSERT INTO availability (user_id, day, start, "end") VALUES (?, ?, ?, ?)')
      .run(id, day, '17:00', '18:00');
  }
  return { id, cookie: `uiuc_gym_buddy_session=${token}` };
}

async function request(endpoint, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers: {
      origin: base,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function futureDate(days) {
  const date = new Date(`${chicagoNow().date}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function holdFirstConflictReads(queryPattern, work) {
  const originalPrepare = db.prepare.bind(db);
  let reads = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  // With a transaction lock, only the first request can reach the query;
  // release it shortly so the queued request can then see the new row.
  const timeout = setTimeout(release, 80);
  db.prepare = sql => {
    const statement = originalPrepare(sql);
    if (!queryPattern.test(sql)) return statement;
    return {
      get: (...params) => {
        const result = statement.get(...params);
        if (++reads === 2) release();
        return gate.then(() => result);
      },
    };
  };
  try { return await work(); }
  finally { clearTimeout(timeout); release(); delete db.prepare; }
}

test('concurrent invitations and acceptances cannot double-book a person', async () => {
  const [alice, bob, carol] = [student('Alice'), student('Bob'), student('Carol')];
  const date = futureDate(14);
  const day = weekdayForDate(date);
  const invite = { toUserId: carol.id, activity: 'Strength training', location: 'ARC',
    date, day, start: '17:00', end: '18:00' };
  const invitations = await holdFirstConflictReads(/SELECT 1 FROM meetups\s+WHERE/, () =>
    Promise.all([alice, bob].map(sender => request('/api/meetups', {
      method: 'POST', cookie: sender.cookie, body: invite,
    }))));
  assert.deepEqual(invitations.map(result => result.status).sort(), [201, 409],
    'only one overlapping invitation can reserve Carol’s time');
  assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM meetups WHERE to_user_id = ? AND date = ?
    AND status = 'pending'`).get(carol.id, date).total, 1);

  // Existing pending invitations can predate the concurrency fix. Accepting
  // two overlapping ones at once must still confirm at most one workout.
  const legacyDate = futureDate(21);
  const insert = db.prepare(`INSERT INTO meetups
    (from_user_id, to_user_id, activity, date, day, start, "end", location, status, created_at)
    VALUES (?, ?, 'Strength training', ?, ?, '17:00', '18:00', 'ARC', 'pending', ?)`);
  const first = insert.run(alice.id, carol.id, legacyDate, weekdayForDate(legacyDate), new Date().toISOString());
  const second = insert.run(bob.id, carol.id, legacyDate, weekdayForDate(legacyDate), new Date().toISOString());
  const acceptances = await holdFirstConflictReads(/SELECT 1 FROM meetups WHERE id !=/, () =>
    Promise.all([first, second].map(row => request(`/api/meetups/${row.lastInsertRowid}`, {
      method: 'PATCH', cookie: carol.cookie, body: { status: 'accepted' },
    }))));
  assert.deepEqual(acceptances.map(result => result.status).sort(), [200, 409],
    'only one overlapping invitation can become confirmed');
  assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM meetups WHERE to_user_id = ? AND date = ?
    AND status = 'accepted'`).get(carol.id, legacyDate).total, 1);
});
