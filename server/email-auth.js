import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { InputError } from './core.js';

const VERIFY_AGE_MS = 30 * 60 * 1000;
const RESET_AGE_MS = 20 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const tokenHash = token => createHash('sha256').update(token).digest('hex');

export function emailAuthSettings() {
  const { RESEND_API_KEY, EMAIL_FROM, PUBLIC_APP_URL, SMTP_HOST, SMTP_PORT,
    SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!EMAIL_FROM || !PUBLIC_APP_URL || (!SMTP_HOST && !RESEND_API_KEY)) return null;
  const url = new URL(PUBLIC_APP_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('PUBLIC_APP_URL must use HTTPS (localhost HTTP is allowed for development).');
  }
  if (url.search || url.hash || url.username || url.password) throw new Error('PUBLIC_APP_URL must be a plain app URL.');
  const common = { from: EMAIL_FROM, appUrl: url.href };
  if (!SMTP_HOST) return { ...common, delivery: 'resend', apiKey: RESEND_API_KEY };

  const port = SMTP_PORT ? Number(SMTP_PORT) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535.');
  }
  if (Boolean(SMTP_USER) !== Boolean(SMTP_PASSWORD)) {
    throw new Error('Set both SMTP_USER and SMTP_PASSWORD, or neither.');
  }
  const secure = port === 465;
  return {
    ...common,
    delivery: 'smtp',
    smtp: {
      host: SMTP_HOST,
      port,
      secure,
      requireTLS: !secure,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      ...(SMTP_USER ? { auth: { user: SMTP_USER, pass: SMTP_PASSWORD } } : {}),
    },
  };
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new InputError('Enter a valid email address.');
  return email;
}

function passwordField(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 200) {
    throw new InputError('Use a password between 12 and 200 characters.');
  }
  return value;
}

function onlyKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

async function limited(db, kind, value, limit, windowMs) {
  const key = tokenHash(`${kind}:${value}`);
  const now = Date.now();
  await db.prepare('DELETE FROM email_auth_limits WHERE window_end < ?').run(now - 24 * 60 * 60 * 1000);
  const row = await db.prepare('SELECT count, window_end FROM email_auth_limits WHERE key = ?').get(key);
  if (row?.window_end > now && row.count >= limit) throw new InputError('Too many attempts. Please try again later.', 429);
  if (!row || row.window_end <= now) {
    await db.prepare(`INSERT INTO email_auth_limits (key, count, window_end) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = 1, window_end = excluded.window_end`).run(key, now + windowMs);
  } else {
    await db.prepare('UPDATE email_auth_limits SET count = count + 1 WHERE key = ?').run(key);
  }
}

async function createToken(db, userId, purpose, ageMs) {
  const token = randomBytes(32).toString('base64url');
  await db.prepare('DELETE FROM email_auth_tokens WHERE expires_at <= ?').run(Date.now());
  // Keep earlier delivered links usable until one succeeds or expires.
  await db.prepare(`INSERT INTO email_auth_tokens (token_hash, user_id, purpose, expires_at)
    VALUES (?, ?, ?, ?)`).run(tokenHash(token), userId, purpose, Date.now() + ageMs);
  return token;
}

async function transaction(db, operation) {
  if (typeof db.transaction === 'function') return db.transaction(operation);
  if (db.kind === 'postgres') throw new Error('The Postgres database adapter must provide transaction().');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = await operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}

function link(settings, kind, token) {
  const url = new URL(settings.appUrl);
  url.hash = `${kind}=${encodeURIComponent(token)}`;
  return url.href;
}

async function sendEmail(settings, to, subject, body, createSmtpTransport) {
  if (settings.delivery === 'smtp') {
    try {
      await createSmtpTransport(settings.smtp).sendMail({ from: settings.from, to, subject, text: body });
      return;
    } catch (error) {
      console.error('Email delivery failed via SMTP:', error?.code || 'unknown error');
      throw new InputError('Email could not be sent. Please try again later.', 503);
    }
  }
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: settings.from, to: [to], subject, text: body }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new InputError('Email could not be sent. Please try again later.', 503);
  }
  if (!response.ok) {
    console.error('Email delivery failed:', response.status);
    throw new InputError('Email could not be sent. Please try again later.', 503);
  }
}

export function initializeEmailAuth(db) {
  if (db.kind === 'postgres') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_identities (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      verified_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS email_auth_tokens_user ON email_auth_tokens(user_id, purpose);
    CREATE TABLE IF NOT EXISTS email_auth_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      window_end INTEGER NOT NULL
    );
  `);
}

export async function hasVerifiedIdentity(db, userId) {
  if (await db.prepare(`SELECT 1 FROM netid_identities WHERE user_id = ?`).get(userId)) return true;
  return Boolean(await db.prepare(`SELECT 1 FROM email_identities WHERE user_id = ? AND verified_at IS NOT NULL`).get(userId));
}

export function registerEmailRoutes({ app, db, createSession, profile, hashPassword, passwordMatches,
  createSmtpTransport = nodemailer.createTransport }) {
  const settings = emailAuthSettings();
  const deliver = (config, to, subject, body) => sendEmail(config, to, subject, body, createSmtpTransport);
  const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const enabled = () => {
    if (!settings) throw new InputError('Email sign-in is awaiting setup.', 503);
    return settings;
  };
  const generic = { ok: true };

  app.post('/api/auth/email/register', handle(async (req, res) => {
    const config = enabled();
    if (!onlyKeys(req.body, ['name', 'email', 'password'])) throw new InputError('Enter your name, email, and password.');
    await limited(db, 'register-ip', req.ip, 10, 60 * 60 * 1000);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 80) throw new InputError('Name must be 2–80 characters.');
    const email = normalizeEmail(req.body.email);
    await limited(db, 'register-email', email, 3, 60 * 60 * 1000);
    const password = passwordField(req.body.password);
    if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new InputError('This email already has an account. Sign in or request a password reset; a pilot account needs migration.', 409);
    }
    const { salt, hash } = await hashPassword(password);
    let userId;
    try {
      await transaction(db, async () => {
        const created = await db.prepare(`INSERT INTO users (name, email, password_hash, password_salt, created_at)
          VALUES (?, ?, ?, ?, ?) RETURNING id`).get(name, email, hash, salt, new Date().toISOString());
        if (!created) throw new Error('User insert did not return an id.');
        userId = created.id;
        await db.prepare('INSERT INTO email_identities (user_id, verified_at, created_at) VALUES (?, NULL, ?)')
          .run(userId, Date.now());
      });
    } catch (error) {
      if (error?.code === '23505' || String(error.message).includes('UNIQUE')) {
        throw new InputError('This email already has an account.', 409);
      }
      throw error;
    }
    const token = await createToken(db, userId, 'verify', VERIFY_AGE_MS);
    try {
      await deliver(config, email, 'Verify your UIUC Gym Buddy email',
        `Use this link to verify your email and finish creating your account:\n\n${link(config, 'verify', token)}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`);
    } catch (error) {
      // Avoid a stranded address after a failed first delivery. An existing
      // account is never deleted by resend or password-reset failures.
      await db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      throw error;
    }
    res.status(202).json({ verificationRequired: true, message: 'Check your email for a verification link.' });
  }));

  app.post('/api/auth/email/verify', handle(async (req, res) => {
    enabled();
    if (!onlyKeys(req.body, ['token']) || !TOKEN_PATTERN.test(req.body.token || '')) {
      throw new InputError('The verification link is invalid.');
    }
    let userId;
    await transaction(db, async () => {
      const row = await db.prepare(`SELECT t.user_id, t.expires_at, e.verified_at FROM email_auth_tokens t
        JOIN email_identities e ON e.user_id = t.user_id
        WHERE t.token_hash = ? AND t.purpose = 'verify'`).get(tokenHash(req.body.token));
      if (!row || row.expires_at <= Date.now() || row.verified_at) {
        throw new InputError('This verification link expired or was already used. Request a new link.', 400);
      }
      userId = row.user_id;
      await db.prepare('UPDATE email_identities SET verified_at = ? WHERE user_id = ?').run(Date.now(), userId);
      await db.prepare('DELETE FROM email_auth_tokens WHERE user_id = ? AND purpose = ?').run(userId, 'verify');
    });
    await createSession(req, res, userId);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.json({ user: profile(user, true) });
  }));

  app.post('/api/auth/email/resend', handle(async (req, res) => {
    const config = enabled();
    if (!onlyKeys(req.body, ['email'])) throw new InputError('Enter your email address.');
    await limited(db, 'resend-ip', req.ip, 10, 60 * 60 * 1000);
    const email = normalizeEmail(req.body.email);
    await limited(db, 'resend-email', email, 3, 60 * 60 * 1000);
    const user = await db.prepare(`SELECT u.id FROM users u JOIN email_identities e ON e.user_id = u.id
      WHERE u.email = ? AND e.verified_at IS NULL`).get(email);
    if (user) {
      const token = await createToken(db, user.id, 'verify', VERIFY_AGE_MS);
      try {
        await deliver(config, email, 'Verify your UIUC Gym Buddy email',
          `Use this link to verify your email:\n\n${link(config, 'verify', token)}\n\nThis link expires in 30 minutes.`);
      } catch {
        await db.prepare('DELETE FROM email_auth_tokens WHERE token_hash = ?').run(tokenHash(token));
        // Keep account existence private. Earlier delivered links still work.
      }
    }
    res.json({ ...generic, message: 'If that address has a pending account, a new link is on its way.' });
  }));

  app.post('/api/auth/email/login', handle(async (req, res) => {
    enabled();
    if (!onlyKeys(req.body, ['email', 'password'])) throw new InputError('Enter your email and password.');
    await limited(db, 'login-ip', req.ip, 20, 15 * 60 * 1000);
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;
    if (typeof password !== 'string') throw new InputError('Enter your email and password.');
    const user = await db.prepare(`SELECT u.* FROM users u JOIN email_identities e ON e.user_id = u.id
      WHERE u.email = ?`).get(email);
    if (!user || !(await passwordMatches(password, user.password_salt, user.password_hash))) {
      throw new InputError('Email or password is incorrect.', 401);
    }
    if (!await hasVerifiedIdentity(db, user.id)) {
      throw new InputError('Verify your email before signing in. You can request a new link.', 403);
    }
    await createSession(req, res, user.id);
    res.json({ user: profile(user, true) });
  }));

  app.post('/api/auth/email/reset/request', handle(async (req, res) => {
    const config = enabled();
    if (!onlyKeys(req.body, ['email'])) throw new InputError('Enter your email address.');
    await limited(db, 'reset-ip', req.ip, 10, 60 * 60 * 1000);
    const email = normalizeEmail(req.body.email);
    await limited(db, 'reset-email', email, 3, 60 * 60 * 1000);
    const user = await db.prepare(`SELECT u.id FROM users u JOIN email_identities e ON e.user_id = u.id
      WHERE u.email = ? AND e.verified_at IS NOT NULL`).get(email);
    if (user) {
      const token = await createToken(db, user.id, 'reset', RESET_AGE_MS);
      try {
        await deliver(config, email, 'Reset your UIUC Gym Buddy password',
          `Use this link to set a new password:\n\n${link(config, 'reset', token)}\n\nThis link expires in 20 minutes. If you did not request it, ignore this email.`);
      } catch {
        await db.prepare('DELETE FROM email_auth_tokens WHERE token_hash = ?').run(tokenHash(token));
        // Keep account existence private. Earlier delivered links still work.
      }
    }
    res.json({ ...generic, message: 'If that address has a verified account, a reset link is on its way.' });
  }));

  app.post('/api/auth/email/reset/complete', handle(async (req, res) => {
    enabled();
    if (!onlyKeys(req.body, ['token', 'password']) || !TOKEN_PATTERN.test(req.body.token || '')) {
      throw new InputError('The reset link is invalid.');
    }
    await limited(db, 'reset-complete-ip', req.ip, 20, 60 * 60 * 1000);
    const password = passwordField(req.body.password);
    const { salt, hash } = await hashPassword(password);
    await transaction(db, async () => {
      const row = await db.prepare(`SELECT t.user_id, t.expires_at FROM email_auth_tokens t
        JOIN email_identities e ON e.user_id = t.user_id
        WHERE t.token_hash = ? AND t.purpose = 'reset' AND e.verified_at IS NOT NULL`).get(tokenHash(req.body.token));
      if (!row || row.expires_at <= Date.now()) throw new InputError('This reset link expired or was already used.', 400);
      await db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, row.user_id);
      await db.prepare('DELETE FROM email_auth_tokens WHERE user_id = ? AND purpose = ?').run(row.user_id, 'reset');
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    });
    res.clearCookie('uiuc_gym_buddy_session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' || req.secure,
      sameSite: 'lax',
      path: '/',
    });
    res.json(generic);
  }));
}
