import * as oidc from 'openid-client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { InputError } from './core.js';

const FLOW_COOKIE = 'uiuc_gym_buddy_netid_flow';
const FLOW_AGE_MS = 10 * 60 * 1000;
const TICKET_AGE_MS = 2 * 60 * 1000;
const NATIVE_CALLBACK = 'uiucgymbuddy://auth-callback';
const START_WINDOW_MS = 15 * 60 * 1000;
const MAX_STARTS_PER_IP = 10;
const MAX_PENDING_FLOWS = 500;

const hash = value => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');

export function netidEmailFromClaims(claims) {
  // A plain email claim can be self-reported by some providers. Prefer the
  // university sign-in identifier, or a separately verified email claim.
  const identities = [claims?.preferred_username, claims?.upn];
  if (claims?.email_verified === true) identities.push(claims.email);
  for (const value of identities) {
    if (typeof value !== 'string') continue;
    const email = value.trim().toLowerCase();
    if (/^[a-z0-9._%+-]+@illinois\.edu$/.test(email)) return email;
  }
  return null;
}

export function pkceChallenge(verifier) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    throw new InputError('The iPhone sign-in request is invalid.');
  }
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createNetidStartLimiter() {
  const attempts = new Map();
  return (ip, now = Date.now()) => {
    for (const [key, times] of attempts) {
      const recent = times.filter(time => now - time < START_WINDOW_MS);
      if (recent.length) attempts.set(key, recent);
      else attempts.delete(key);
    }
    const key = String(ip || 'unknown');
    const recent = attempts.get(key) || [];
    if (recent.length >= MAX_STARTS_PER_IP || attempts.size >= 10_000 && !attempts.has(key)) {
      throw new InputError('Too many Illinois sign-in attempts. Please try again later.', 429);
    }
    recent.push(now);
    attempts.set(key, recent);
  };
}

function settings() {
  const issuer = process.env.ILLINOIS_OIDC_ISSUER;
  const clientId = process.env.ILLINOIS_OIDC_CLIENT_ID;
  const clientSecret = process.env.ILLINOIS_OIDC_CLIENT_SECRET;
  const redirectUri = process.env.ILLINOIS_OIDC_REDIRECT_URI;
  if (![issuer, clientId, clientSecret, redirectUri].every(Boolean)) return null;
  const issuerUrl = new URL(issuer);
  const callbackUrl = new URL(redirectUri);
  if (issuerUrl.protocol !== 'https:' || callbackUrl.pathname !== '/api/auth/netid/callback'
    || (callbackUrl.protocol !== 'https:' && !(callbackUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(callbackUrl.hostname)))) {
    throw new Error('Illinois OIDC settings must use an HTTPS issuer and an HTTPS callback (localhost HTTP is allowed for development).');
  }
  return { issuerUrl, clientId, clientSecret, redirectUri };
}

function flowCookieOptions(req) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production' || req.secure || process.env.COOKIE_SECURE === 'true', sameSite: 'lax', path: '/api/auth/netid' };
}

function readCookie(req, name) {
  return (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function cleanExpired(db) {
  const now = Date.now();
  await db.prepare('DELETE FROM netid_flows WHERE created_at < ?').run(now - FLOW_AGE_MS);
  await db.prepare('DELETE FROM netid_native_tickets WHERE expires_at < ?').run(now);
}

function isUniqueViolation(error) {
  return error?.code === '23505' || String(error?.message).includes('UNIQUE');
}

async function withTransaction(db, callback) {
  if (typeof db.transaction === 'function') return db.transaction(callback);

  // Standalone SQLite tests still pass DatabaseSync directly rather than the
  // application database wrapper. Keep those callers compatible as well.
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = await callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

async function getOrCreateUser(db, claims) {
  const email = netidEmailFromClaims(claims);
  if (!email || typeof claims.sub !== 'string' || typeof claims.iss !== 'string') {
    throw new InputError('Illinois sign-in did not provide a usable Illinois email and identity.', 403);
  }
  const subject = `${claims.iss}\u0000${claims.sub}`;
  const existingIdentity = await db.prepare('SELECT user_id FROM netid_identities WHERE subject = ?').get(subject);
  if (existingIdentity) return existingIdentity.user_id;
  const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingUser) {
    // Mailbox verification and campus OIDC both establish control of this
    // Illinois address. Unverified pilot and pending-email accounts cannot
    // be linked by matching a typed address.
    const verified = await db.prepare(`SELECT 1 FROM email_identities
      WHERE user_id = ? AND verified_at IS NOT NULL`).get(existingUser.id);
    if (!verified) {
      throw new InputError('This Illinois email has an unverified account. Account migration is required before NetID sign-in.', 409);
    }
    if (await db.prepare('SELECT 1 FROM netid_identities WHERE user_id = ?').get(existingUser.id)) {
      throw new InputError('This account is already linked to a different Illinois identity. Account review is required.', 409);
    }
    try {
      await db.prepare('INSERT INTO netid_identities (subject, user_id, created_at) VALUES (?, ?, ?)')
        .run(subject, existingUser.id, Date.now());
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new InputError('This Illinois identity is already linked to another account.', 409);
      }
      throw error;
    }
    return existingUser.id;
  }
  const displayName = String(claims.name || claims.given_name || email.split('@')[0]).trim().slice(0, 80) || email.split('@')[0];
  try {
    return await withTransaction(db, async () => {
      const created = await db.prepare(`INSERT INTO users (name, email, password_hash, password_salt, created_at)
        VALUES (?, ?, ?, ?, ?)`).run(displayName, email, randomBytes(64).toString('hex'), randomBytes(16).toString('hex'), new Date().toISOString());
      await db.prepare('INSERT INTO netid_identities (subject, user_id, created_at) VALUES (?, ?, ?)')
        .run(subject, created.lastInsertRowid, Date.now());
      return created.lastInsertRowid;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InputError('This Illinois identity is already linked to another account.', 409);
    }
    throw error;
  }
}

export function registerNetidRoutes({ app, db, createSession, profile,
  pilotAuthEnabled = true, emailAuthEnabled = false }) {
  if (db.kind !== 'postgres') db.exec(`
    CREATE TABLE IF NOT EXISTS netid_identities (
      subject TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS netid_flows (
      state_hash TEXT PRIMARY KEY,
      verifier TEXT NOT NULL,
      nonce TEXT NOT NULL,
      native_challenge TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS netid_native_tickets (
      ticket_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  let discovered;
  const limitStart = createNetidStartLimiter();
  const configuration = () => {
    const configured = settings();
    if (!configured) throw new InputError('Illinois NetID sign-in is awaiting campus app registration.', 503);
    discovered ||= oidc.discovery(configured.issuerUrl, configured.clientId, configured.clientSecret);
    return discovered;
  };
  const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  app.get('/api/auth/netid/config', (req, res) => res.json({
    enabled: Boolean(settings()), pilotAuthEnabled, emailAuthEnabled,
  }));

  app.get('/api/auth/netid/start', handle(async (req, res) => {
    const configured = settings();
    if (!configured) throw new InputError('Illinois NetID sign-in is awaiting campus app registration.', 503);
    limitStart(req.ip);
    const native = req.query.native === '1';
    const nativeChallenge = native ? req.query.code_challenge : null;
    if (native && (typeof nativeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nativeChallenge))) {
      throw new InputError('The iPhone sign-in request is invalid.');
    }
    await cleanExpired(db);
    const pendingFlows = await db.prepare('SELECT COUNT(*) AS count FROM netid_flows').get();
    if (pendingFlows.count >= MAX_PENDING_FLOWS) {
      throw new InputError('Illinois sign-in is busy. Please try again in a few minutes.', 429);
    }
    const config = await configuration();
    const state = randomToken();
    const verifier = oidc.randomPKCECodeVerifier();
    const nonce = oidc.randomNonce();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    await db.prepare('INSERT INTO netid_flows (state_hash, verifier, nonce, native_challenge, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(hash(state), verifier, nonce, nativeChallenge, Date.now());
    res.cookie(FLOW_COOKIE, state, { ...flowCookieOptions(req), maxAge: FLOW_AGE_MS });
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: configured.redirectUri,
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      nonce,
      state,
    });
    res.redirect(url.href);
  }));

  app.get('/api/auth/netid/callback', handle(async (req, res) => {
    const state = req.query.state;
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)
      || readCookie(req, FLOW_COOKIE) !== state) {
      throw new InputError('Illinois sign-in could not be verified. Please try again.', 400);
    }
    const flow = await db.prepare('SELECT * FROM netid_flows WHERE state_hash = ?').get(hash(state));
    if (!flow || Date.now() - flow.created_at > FLOW_AGE_MS) {
      throw new InputError('Illinois sign-in expired. Please try again.', 400);
    }
    await db.prepare('DELETE FROM netid_flows WHERE state_hash = ?').run(hash(state));
    res.clearCookie(FLOW_COOKIE, flowCookieOptions(req));
    const configured = settings();
    if (!configured) throw new InputError('Illinois NetID sign-in is awaiting campus app registration.', 503);
    const callbackUrl = new URL(req.originalUrl, configured.redirectUri);
    const tokens = await oidc.authorizationCodeGrant(await configuration(), callbackUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedNonce: flow.nonce,
      expectedState: state,
      idTokenExpected: true,
    });
    const userId = await getOrCreateUser(db, tokens.claims());
    if (flow.native_challenge) {
      const ticket = randomToken();
      await db.prepare('INSERT INTO netid_native_tickets (ticket_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)')
        .run(hash(ticket), userId, flow.native_challenge, Date.now() + TICKET_AGE_MS);
      res.redirect(`${NATIVE_CALLBACK}?code=${ticket}`);
      return;
    }
    await createSession(req, res, userId);
    res.redirect('/');
  }));

  app.post('/api/auth/netid/native/complete', handle(async (req, res) => {
    const { code, verifier } = req.body || {};
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
      throw new InputError('The iPhone sign-in code is invalid.');
    }
    const challenge = pkceChallenge(verifier);
    await cleanExpired(db);
    const ticket = await db.prepare('SELECT * FROM netid_native_tickets WHERE ticket_hash = ?').get(hash(code));
    if (!ticket || ticket.expires_at <= Date.now()
      || !timingSafeEqual(Buffer.from(challenge), Buffer.from(ticket.challenge))) {
      throw new InputError('The iPhone sign-in code expired or could not be verified.', 401);
    }
    const consumed = await db.prepare(`DELETE FROM netid_native_tickets
      WHERE ticket_hash = ? AND challenge = ? AND expires_at > ?`)
      .run(hash(code), challenge, Date.now());
    if (consumed.changes !== 1) {
      throw new InputError('The iPhone sign-in code expired or could not be verified.', 401);
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.user_id);
    if (!user) throw new InputError('This Illinois account is no longer available.', 404);
    await createSession(req, res, user.id);
    res.json({ user: profile(user, true) });
  }));
}
