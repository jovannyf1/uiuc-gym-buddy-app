import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.PG_TEST_URL;
const originalFetch = globalThis.fetch;
const sentEmails = [];
let server;
let db;
let auditPool;

test('PostgreSQL email account journey, matching, chat, limits, and persistence', {
  skip: !connectionString,
}, async () => {
  process.env.SUPABASE_DATABASE_URL = connectionString;
  process.env.NODE_ENV = 'production';
  process.env.ALLOW_PILOT_AUTH = 'false';
  process.env.ILLINOIS_OIDC_ISSUER = '';
  process.env.ILLINOIS_OIDC_CLIENT_ID = '';
  process.env.ILLINOIS_OIDC_CLIENT_SECRET = '';
  process.env.ILLINOIS_OIDC_REDIRECT_URI = '';
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'Illini Workout Buddy <test@example.com>';
  process.env.PUBLIC_APP_URL = 'http://127.0.0.1:5174/';

  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://api.resend.com/emails') {
      sentEmails.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: `test-${sentEmails.length}` }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(url, options);
  };

  const [{ app, db: database }, { createDatabase }] = await Promise.all([
    import('./index.js'), import('./database.js'),
  ]);
  db = database;
  server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (endpoint, { method = 'GET', cookie, body } = {}) => {
    const response = await originalFetch(`${base}${endpoint}`, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  };

  // A second startup must safely reuse the versioned schema.
  const secondDatabase = await createDatabase();
  await secondDatabase.close();

  const runId = randomBytes(5).toString('hex');
  const originalPassword = 'postgres-test-password';
  const verifiedStudent = async (name, email) => {
    const registered = await request('/api/auth/email/register', {
      method: 'POST', body: { name, email, password: originalPassword },
    });
    assert.equal(registered.status, 202);
    assert.equal(registered.cookie, undefined, 'sign-up does not create a session before verification');
    const message = sentEmails.at(-1);
    assert.deepEqual(message.to, [email]);
    const unverifiedLogin = await request('/api/auth/email/login', {
      method: 'POST', body: { email, password: originalPassword },
    });
    assert.equal(unverifiedLogin.status, 403, 'sign-in is blocked until inbox verification');
    assert.equal(unverifiedLogin.cookie, undefined);
    const token = /#verify=([A-Za-z0-9_-]{43})/.exec(message.text)?.[1];
    assert.ok(token, 'verification email includes a link token');
    const verified = await request('/api/auth/email/verify', { method: 'POST', body: { token } });
    assert.equal(verified.status, 200);
    assert.ok(verified.cookie, 'verification starts a session');
    return { id: verified.body.user.id, cookie: verified.cookie };
  };

  const aliceEmail = `alice-${runId}@example.com`;
  const alice = await verifiedStudent('Alice Test', aliceEmail);
  const bob = await verifiedStudent('Bob Test', `bob-${runId}@example.com`);
  const profile = {
    activities: ['Strength training'], locations: ['ARC'],
    experience: 'beginner', bio: 'Looking for a weekday gym buddy.',
  };
  const slots = Array.from({ length: 7 }, (_, day) => ({ day, start: '06:00', end: '23:00' }));
  for (const student of [alice, bob]) {
    assert.equal((await request('/api/me', { method: 'PATCH', cookie: student.cookie, body: profile })).status, 200);
    assert.equal((await request('/api/availability', {
      method: 'PUT', cookie: student.cookie, body: { slots },
    })).status, 200);
  }

  const matches = await request('/api/matches', { cookie: alice.cookie });
  assert.equal(matches.status, 200);
  assert.deepEqual(matches.body.matches.map(match => match.user.id), [bob.id]);

  const started = await request('/api/chats', {
    method: 'POST', cookie: alice.cookie, body: { toUserId: bob.id },
  });
  assert.equal(started.status, 201);
  const chatId = started.body.chat.id;
  const sent = await request(`/api/chats/${chatId}/messages`, {
    method: 'POST', cookie: alice.cookie, body: { text: 'Want to meet at ARC?' },
  });
  assert.equal(sent.status, 201);
  const inbox = await request(`/api/chats/${chatId}/messages`, { cookie: bob.cookie });
  assert.equal(inbox.body.messages[0].text, 'Want to meet at ARC?');

  // Seed ten recent chat starts and confirm the eleventh is rejected. This
  // catches promise/row handling that synchronous SQLite does not exercise.
  const extraIds = [];
  for (let index = 0; index < 11; index += 1) {
    const created = await db.prepare(`INSERT INTO users
      (name, email, password_hash, password_salt, activities, locations, created_at)
      VALUES (?, ?, 'unused', 'unused', ?, ?, ?) RETURNING id`)
      .get(`Limit Test ${index}`, `limit-${runId}-${index}@example.com`, JSON.stringify(profile.activities),
        JSON.stringify(profile.locations), new Date().toISOString());
    extraIds.push(created.id);
    await db.prepare('INSERT INTO email_identities (user_id, verified_at, created_at) VALUES (?, ?, ?)')
      .run(created.id, Date.now(), Date.now());
  }
  const nowMs = Date.now();
  for (const targetId of extraIds.slice(0, 10)) {
    const [firstId, secondId] = [alice.id, targetId].sort((a, b) => a - b);
    await db.prepare(`INSERT INTO chats
      (user_a_id, user_b_id, initiated_by_user_id, created_at, created_at_ms, updated_at, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(firstId, secondId, alice.id, new Date(nowMs - 5_000).toISOString(), nowMs - 5_000,
        new Date(nowMs - 5_000).toISOString(), nowMs - 5_000);
  }
  const limitedChat = await request('/api/chats', {
    method: 'POST', cookie: alice.cookie, body: { toUserId: extraIds[10] },
  });
  assert.equal(limitedChat.status, 429);

  // Keep seeded messages outside the one-second cooldown but inside the hour.
  const recentMs = Date.now() - 5_000;
  for (let index = 0; index < 60; index += 1) {
    await db.prepare(`INSERT INTO chat_messages
      (chat_id, sender_user_id, body, created_at, created_at_ms) VALUES (?, ?, ?, ?, ?)`)
      .run(chatId, alice.id, `Seed ${index}`, new Date(recentMs).toISOString(), recentMs);
  }
  const limitedMessage = await request(`/api/chats/${chatId}/messages`, {
    method: 'POST', cookie: alice.cookie, body: { text: 'This should be rate limited.' },
  });
  assert.equal(limitedMessage.status, 429);

  const saved = await db.prepare(`SELECT m.body FROM chat_messages m WHERE m.chat_id = ?
    AND m.body = ?`).get(chatId, 'Want to meet at ARC?');
  assert.equal(saved.body, 'Want to meet at ARC?');

  // A reset must invalidate the old session and password while preserving the
  // member's saved profile and availability.
  const resetRequested = await request('/api/auth/email/reset/request', {
    method: 'POST', body: { email: aliceEmail },
  });
  assert.equal(resetRequested.status, 200);
  const resetMessage = sentEmails.at(-1);
  assert.deepEqual(resetMessage.to, [aliceEmail]);
  const resetToken = /#reset=([A-Za-z0-9_-]{43})/.exec(resetMessage.text)?.[1];
  assert.ok(resetToken, 'password-reset email includes a link token');
  const newPassword = 'postgres-new-test-password';
  const resetCompleted = await request('/api/auth/email/reset/complete', {
    method: 'POST', cookie: alice.cookie, body: { token: resetToken, password: newPassword },
  });
  assert.equal(resetCompleted.status, 200);
  assert.equal((await request('/api/me', { cookie: alice.cookie })).status, 401,
    'password reset invalidates the previous session');
  assert.equal((await request('/api/auth/email/login', {
    method: 'POST', body: { email: aliceEmail, password: originalPassword },
  })).status, 401, 'the old password no longer signs in');
  const newLogin = await request('/api/auth/email/login', {
    method: 'POST', body: { email: aliceEmail, password: newPassword },
  });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.body.user.id, alice.id);
  assert.ok(newLogin.cookie, 'the new password starts a session');
  const savedProfile = await request('/api/me', { cookie: newLogin.cookie });
  assert.equal(savedProfile.status, 200);
  assert.equal(savedProfile.body.user.bio, profile.bio);
  assert.deepEqual(savedProfile.body.user.activities, profile.activities);
  assert.deepEqual((await request('/api/availability', { cookie: newLogin.cookie })).body.slots, slots);

  // Even a role with SELECT grants cannot read app records without an RLS policy.
  auditPool = new Pool({ connectionString });
  const auditClient = await auditPool.connect();
  try {
    await auditClient.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gym_buddy_anon_test') THEN
        CREATE ROLE gym_buddy_anon_test NOLOGIN;
      END IF;
    END $$`);
    await auditClient.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO gym_buddy_anon_test');
    await auditClient.query('SET ROLE gym_buddy_anon_test');
    const privateRows = await auditClient.query('SELECT id, email, password_hash FROM users');
    assert.equal(privateRows.rowCount, 0);
    await auditClient.query('RESET ROLE');
  } finally {
    auditClient.release();
  }

  // Reopen the database after the API's pool closes, as a later deployment
  // instance would. These values must come from PostgreSQL, not process state.
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server = undefined;
  await db.close();
  db = undefined;
  const reconnected = await createDatabase();
  try {
    const persistedProfile = await reconnected.prepare('SELECT email, bio, activities FROM users WHERE id = ?')
      .get(alice.id);
    assert.equal(persistedProfile.email, aliceEmail);
    assert.equal(persistedProfile.bio, profile.bio);
    assert.deepEqual(JSON.parse(persistedProfile.activities), profile.activities);
    const persistedAvailability = await reconnected.prepare('SELECT COUNT(*) AS count FROM availability WHERE user_id = ?')
      .get(alice.id);
    assert.equal(Number(persistedAvailability.count), slots.length);
    const persistedMessage = await reconnected.prepare('SELECT body FROM chat_messages WHERE chat_id = ? AND body = ?')
      .get(chatId, 'Want to meet at ARC?');
    assert.equal(persistedMessage.body, 'Want to meet at ARC?');
  } finally {
    await reconnected.close();
  }
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (auditPool) await auditPool.end();
  if (db) await db.close();
  globalThis.fetch = originalFetch;
});
