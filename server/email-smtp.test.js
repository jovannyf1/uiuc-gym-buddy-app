import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { emailAuthSettings, initializeEmailAuth, registerEmailRoutes } from './email-auth.js';

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = 'production';
process.env.SMTP_HOST = 'smtp-example.alwaysdata.net';
process.env.SMTP_PORT = '465';
process.env.SMTP_USER = 'gym@example.alwaysdata.net';
process.env.SMTP_PASSWORD = 'test-mailbox-password';
process.env.RESEND_API_KEY = 're_should_not_be_used';
process.env.EMAIL_FROM = 'UIUC Gym Buddy <gym@example.alwaysdata.net>';
process.env.PUBLIC_APP_URL = 'https://gym-buddy.vercel.app/';

// HTTP requests below use originalFetch. A stray Resend call must fail the test.
globalThis.fetch = async (input, init) => {
  if (String(input) === 'https://api.resend.com/emails') throw new Error('SMTP should take precedence over Resend');
  return originalFetch(input, init);
};

const db = new DatabaseSync(':memory:');
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE netid_identities (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
`);
initializeEmailAuth(db);

const messages = [];
const transports = [];
let deliveryFails = false;
let sessionsCreated = 0;
const app = express();
app.use(express.json());
registerEmailRoutes({
  app,
  db,
  createSession: () => { sessionsCreated += 1; },
  profile: user => ({ id: user.id, email: user.email }),
  hashPassword: async password => ({ salt: 'test-salt', hash: `hash:${password}` }),
  passwordMatches: async (password, _salt, hash) => hash === `hash:${password}`,
  createSmtpTransport: options => {
    transports.push(options);
    return {
      sendMail: async message => {
        if (deliveryFails) throw Object.assign(new Error('mailbox unavailable'), { code: 'ECONNECTION' });
        messages.push(message);
      },
    };
  },
});
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

async function request(endpoint, body) {
  const response = await originalFetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('SMTP sends a verifiable signup link over configured TLS and failed delivery leaves no account', async () => {
  const registered = await request('/api/auth/email/register', {
    name: 'SMTP Student', email: 'student@example.org', password: 'long-test-password',
  });
  assert.equal(registered.status, 202);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].from, process.env.EMAIL_FROM);
  assert.equal(messages[0].to, 'student@example.org');
  assert.match(messages[0].subject, /Verify/);
  const token = /#verify=([A-Za-z0-9_-]{43})/.exec(messages[0].text)?.[1];
  assert.ok(token, 'SMTP message contains a verification link');
  assert.match(messages[0].text, /https:\/\/gym-buddy\.vercel\.app\/#verify=/);
  assert.equal(transports[0].host, 'smtp-example.alwaysdata.net');
  assert.equal(transports[0].port, 465);
  assert.equal(transports[0].secure, true);
  assert.equal(transports[0].tls.rejectUnauthorized, true);
  assert.deepEqual(transports[0].auth, {
    user: 'gym@example.alwaysdata.net', pass: 'test-mailbox-password',
  });
  assert.equal(sessionsCreated, 0);

  const verified = await request('/api/auth/email/verify', { token });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.email, 'student@example.org');
  assert.equal(sessionsCreated, 1);

  deliveryFails = true;
  const failed = await request('/api/auth/email/register', {
    name: 'Failed Student', email: 'failed@example.org', password: 'another-long-password',
  });
  deliveryFails = false;
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error, 'Email could not be sent. Please try again later.');
  assert.equal(db.prepare('SELECT 1 FROM users WHERE email = ?').get('failed@example.org'), undefined);
  assert.equal(messages.length, 1);
});

test('SMTP settings require paired credentials and STARTTLS on port 587', () => {
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = '';
  process.env.SMTP_PASSWORD = '';
  const settings = emailAuthSettings();
  assert.equal(settings.delivery, 'smtp');
  assert.equal(settings.smtp.secure, false);
  assert.equal(settings.smtp.requireTLS, true);
  assert.equal('auth' in settings.smtp, false);
  process.env.SMTP_USER = 'gym@example.alwaysdata.net';
  assert.throws(() => emailAuthSettings(), /both SMTP_USER and SMTP_PASSWORD/);
});
