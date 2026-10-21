import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewImport } from './import.js';
import { registerNetidRoutes } from './netid.js';
import { registerSocialRoutes } from './social.js';
import { emailAuthSettings, initializeEmailAuth, hasVerifiedIdentity, registerEmailRoutes } from './email-auth.js';
import {
  ACTIVITIES, LOCATIONS, GENDERS, PARTNER_PREFERENCES, EXPERIENCE_LEVELS,
  InputError, timeToMinutes, normalizeSlots, matchDetails, weekdayForDate, chicagoNow,
} from './core.js';

const scrypt = promisify(scryptCallback);
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(serverDir);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectDir, 'data'));
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT 'prefer-not-to-say',
    partner_preference TEXT NOT NULL DEFAULT 'any',
    experience TEXT NOT NULL DEFAULT 'beginner',
    activities TEXT NOT NULL DEFAULT '[]',
    locations TEXT NOT NULL DEFAULT '[]',
    bio TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS availability (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day INTEGER NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    PRIMARY KEY (user_id, day, start, end)
  );
  CREATE TABLE IF NOT EXISTS meetups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity TEXT NOT NULL,
    date TEXT NOT NULL,
    day INTEGER NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    location TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS meetups_from ON meetups(from_user_id);
  CREATE INDEX IF NOT EXISTS meetups_to ON meetups(to_user_id);
`);

const SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MEETUPS_PER_DAY = 10;
const MAX_MEETUPS_TO_ONE_STUDENT_PER_DAY = 3;
const SESSION_COOKIE = 'uiuc_gym_buddy_session';
const netidConfigured = [
  process.env.ILLINOIS_OIDC_ISSUER, process.env.ILLINOIS_OIDC_CLIENT_ID,
  process.env.ILLINOIS_OIDC_CLIENT_SECRET, process.env.ILLINOIS_OIDC_REDIRECT_URI,
].every(Boolean);
const emailAuthEnabled = Boolean(emailAuthSettings());
const pilotAuthEnabled = !netidConfigured && !emailAuthEnabled
  && (process.env.NODE_ENV !== 'production' || process.env.ALLOW_PILOT_AUTH === 'true');
// Old local pilot addresses were never verified. In a configured deployment,
// only a linked NetID or a verified mailbox may reach social data.
const verifiedIdentityRequired = !pilotAuthEnabled;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
});

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '32kb' }));

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function hasOnlyKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

function textField(value, label, { min = 0, max = 300 } = {}) {
  if (typeof value !== 'string') throw new InputError(`${label} is required.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new InputError(`${label} must be ${min}–${max} characters.`);
  }
  return text;
}

function enumField(value, allowed, label) {
  if (!allowed.includes(value)) throw new InputError(`Choose a valid ${label.toLowerCase()}.`);
  return value;
}

function choicesField(value, allowed, label) {
  if (!Array.isArray(value) || value.length > allowed.length || value.some(item => !allowed.includes(item))) {
    throw new InputError(`Choose valid ${label.toLowerCase()}.`);
  }
  return allowed.filter(item => value.includes(item));
}

function profile(row, own = false) {
  const result = {
    id: row.id,
    name: row.name,
    gender: row.gender,
    activities: JSON.parse(row.activities),
    experience: row.experience,
    locations: JSON.parse(row.locations),
    bio: row.bio,
  };
  if (own) {
    result.email = row.email;
    result.partnerPreference = row.partner_preference;
  }
  return result;
}

function matchProfile(row) {
  return { ...profile(row), partnerPreference: row.partner_preference };
}

function slotsFor(userId) {
  return db.prepare('SELECT day, start, end FROM availability WHERE user_id = ? ORDER BY day, start')
    .all(userId);
}

function cookieToken(req) {
  const value = (req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${SESSION_COOKIE}=`));
  const token = value?.slice(SESSION_COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' || req.secure,
    sameSite: 'lax',
    path: '/',
  };
}

function createSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash(token), userId, now + SESSION_AGE_MS, now);
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(req), maxAge: SESSION_AGE_MS });
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64);
  return { salt, hash: derived.toString('hex') };
}

async function passwordMatches(password, salt, storedHash) {
  const candidate = Buffer.from((await hashPassword(password, salt)).hash, 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function requireAuth(req, res, next) {
  const token = cookieToken(req);
  if (!token) return next(new InputError('Sign in to continue.', 401));
  const session = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash(token), Date.now());
  if (!session) return next(new InputError('Sign in to continue.', 401));
  if (verifiedIdentityRequired && !hasVerifiedIdentity(db, session.id)) {
    return next(new InputError('Sign in with a verified email or Illinois NetID to continue.', 401));
  }
  req.user = session;
  next();
}

// Reject cross-origin writes. The Vite development server is the only
// cross-port origin allowed by default; hosted split-origin deployments must
// set CLIENT_ORIGIN explicitly.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.headers.origin) return next();
  try {
    const origin = new URL(req.headers.origin).origin;
    const ownOrigin = `${req.protocol}://${req.get('host')}`;
    const developmentOrigins = process.env.NODE_ENV === 'production' ? []
      : ['http://localhost:5173', 'http://127.0.0.1:5173'];
    const allowed = [ownOrigin, process.env.CLIENT_ORIGIN, ...developmentOrigins];
    if (allowed.includes(origin)) return next();
  } catch { /* Reject malformed Origin values. */ }
  next(new InputError('Request origin is not allowed.', 403));
});

initializeEmailAuth(db);
const trustedUser = userId => !verifiedIdentityRequired || hasVerifiedIdentity(db, userId);
registerSocialRoutes({ app, db, requireAuth, verifiedIdentityRequired, trustedUser });
const blockedPair = db.prepare(`SELECT 1 FROM user_blocks
  WHERE (blocker_user_id = ? AND blocked_user_id = ?)
     OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1`);
function usersBlocked(firstId, secondId) {
  return Boolean(blockedPair.get(firstId, secondId, secondId, firstId));
}

app.post('/api/auth/register', wrap(async (req, res) => {
  if (!pilotAuthEnabled) throw new InputError('Pilot sign-up is unavailable. Use verified email or Illinois NetID sign-in.', 403);
  if (!hasOnlyKeys(req.body, ['name', 'email', 'password'])) throw new InputError('Enter your name, Illinois email, and password.');
  const name = textField(req.body.name, 'Name', { min: 2, max: 80 });
  const email = textField(req.body.email, 'Email', { min: 1, max: 254 }).toLowerCase();
  if (!/^[a-z0-9._%+-]+@illinois\.edu$/.test(email)) {
    throw new InputError('Use an @illinois.edu email address.');
  }
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new InputError('Use a password between 8 and 200 characters.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new InputError('An account with this email already exists.', 409);
  }
  const { salt, hash } = await hashPassword(password);
  let result;
  try {
    result = db.prepare(`INSERT INTO users (name, email, password_hash, password_salt, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(name, email, hash, salt, new Date().toISOString());
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new InputError('An account with this email already exists.', 409);
    throw error;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  createSession(req, res, user.id);
  res.status(201).json({ user: profile(user, true) });
}));

const loginFailures = new Map();
app.post('/api/auth/login', wrap(async (req, res) => {
  if (!pilotAuthEnabled) throw new InputError('Pilot sign-in is unavailable. Use verified email or Illinois NetID sign-in.', 403);
  if (!hasOnlyKeys(req.body, ['email', 'password'])) throw new InputError('Enter your email and password.');
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password;
  if (!email || typeof password !== 'string') throw new InputError('Enter your email and password.');
  const key = req.ip;
  const now = Date.now();
  const recent = (loginFailures.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  if (recent.length >= 20) throw new InputError('Too many sign-in attempts. Try again later.', 429);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await passwordMatches(password, user.password_salt, user.password_hash))) {
    recent.push(now);
    loginFailures.set(key, recent);
    throw new InputError('Email or password is incorrect.', 401);
  }
  loginFailures.delete(key);
  createSession(req, res, user.id);
  res.json({ user: profile(user, true) });
}));

app.post('/api/auth/logout', (req, res) => {
  const token = cookieToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req));
  res.json({ ok: true });
});

registerNetidRoutes({ app, db, createSession, profile, pilotAuthEnabled, emailAuthEnabled });
registerEmailRoutes({ app, db, createSession, profile, hashPassword, passwordMatches });

app.get('/api/me', requireAuth, (req, res) => res.json({ user: profile(req.user, true) }));

app.patch('/api/me', requireAuth, (req, res, next) => {
  try {
    const keys = ['name', 'gender', 'partnerPreference', 'experience', 'activities', 'locations', 'bio'];
    if (!hasOnlyKeys(req.body, keys) || Object.keys(req.body).length === 0) {
      throw new InputError('Choose profile details to update.');
    }
    const current = req.user;
    const name = 'name' in req.body ? textField(req.body.name, 'Name', { min: 2, max: 80 }) : current.name;
    const gender = 'gender' in req.body ? enumField(req.body.gender, GENDERS, 'gender') : current.gender;
    const preference = 'partnerPreference' in req.body
      ? enumField(req.body.partnerPreference, PARTNER_PREFERENCES, 'partner preference') : current.partner_preference;
    const experience = 'experience' in req.body
      ? enumField(req.body.experience, EXPERIENCE_LEVELS, 'experience level') : current.experience;
    const activities = 'activities' in req.body
      ? choicesField(req.body.activities, ACTIVITIES, 'activities') : JSON.parse(current.activities);
    const locations = 'locations' in req.body
      ? choicesField(req.body.locations, LOCATIONS, 'locations') : JSON.parse(current.locations);
    const bio = 'bio' in req.body ? textField(req.body.bio, 'Bio', { max: 300 }) : current.bio;
    db.prepare(`UPDATE users SET name = ?, gender = ?, partner_preference = ?, experience = ?,
      activities = ?, locations = ?, bio = ? WHERE id = ?`)
      .run(name, gender, preference, experience, JSON.stringify(activities), JSON.stringify(locations), bio, current.id);
    res.json({ user: profile(db.prepare('SELECT * FROM users WHERE id = ?').get(current.id), true) });
  } catch (error) { next(error); }
});

app.get('/api/availability', requireAuth, (req, res) => res.json({ slots: slotsFor(req.user.id) }));

app.put('/api/availability', requireAuth, (req, res, next) => {
  try {
    if (!hasOnlyKeys(req.body, ['slots']) || !('slots' in req.body)) {
      throw new InputError('Provide available times to save.');
    }
    const slots = normalizeSlots(req.body.slots);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM availability WHERE user_id = ?').run(req.user.id);
      const insert = db.prepare('INSERT INTO availability (user_id, day, start, end) VALUES (?, ?, ?, ?)');
      for (const slot of slots) insert.run(req.user.id, slot.day, slot.start, slot.end);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ slots });
  } catch (error) { next(error); }
});

app.get('/api/matches', requireAuth, (req, res, next) => {
  try {
    const own = matchProfile(req.user);
    const ownSlots = slotsFor(req.user.id);
    if (!ownSlots.length || !own.activities.length || !own.locations.length) return res.json({ matches: [] });
    const people = db.prepare('SELECT * FROM users WHERE id != ?').all(req.user.id);
    const matches = [];
    for (const person of people) {
      if (!trustedUser(person.id)) continue;
      if (usersBlocked(req.user.id, person.id)) continue;
      const details = matchDetails(own, matchProfile(person), ownSlots, slotsFor(person.id));
      if (details) matches.push({ user: profile(person), ...details });
    }
    matches.sort((a, b) => b.score - a.score || a.user.name.localeCompare(b.user.name) || a.user.id - b.user.id);
    res.json({ matches });
  } catch (error) { next(error); }
});

function meetupFor(row) {
  return {
    id: row.id,
    fromUser: { id: row.from_user_id, name: row.from_name },
    toUser: { id: row.to_user_id, name: row.to_name },
    activity: row.activity,
    date: row.date,
    day: row.day,
    start: row.start,
    end: row.end,
    location: row.location,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  };
}

const meetupSelect = `SELECT m.*, sender.name AS from_name, recipient.name AS to_name
  FROM meetups m JOIN users sender ON sender.id = m.from_user_id
  JOIN users recipient ON recipient.id = m.to_user_id`;

app.get('/api/meetups', requireAuth, (req, res) => {
  const rows = db.prepare(`${meetupSelect} WHERE m.from_user_id = ? OR m.to_user_id = ?
    ORDER BY m.date, m.start, m.created_at`).all(req.user.id, req.user.id);
  const visible = rows.filter(row => trustedUser(row.from_user_id) && trustedUser(row.to_user_id));
  res.json({ meetups: visible.map(meetupFor) });
});

function conflicts(userId, date, start, end, excludeId = -1) {
  return Boolean(db.prepare(`SELECT 1 FROM meetups
    WHERE (from_user_id = ? OR to_user_id = ?) AND date = ? AND id != ?
      AND status IN ('pending', 'accepted') AND start < ? AND end > ? LIMIT 1`)
    .get(userId, userId, date, excludeId, end, start));
}

app.post('/api/meetups', requireAuth, (req, res, next) => {
  try {
    const keys = ['toUserId', 'activity', 'date', 'day', 'start', 'end', 'location', 'note'];
    if (!hasOnlyKeys(req.body, keys)) throw new InputError('Check the workout invitation details.');
    const targetId = Number(req.body.toUserId);
    if (!Number.isSafeInteger(targetId) || targetId < 1 || targetId === req.user.id) {
      throw new InputError('Choose another member to invite.');
    }
    const candidate = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    if (!candidate) throw new InputError('This member is no longer available to invite.', 404);
    if (!trustedUser(targetId)) {
      throw new InputError('This member must verify their account before receiving invitations.', 403);
    }
    if (usersBlocked(req.user.id, targetId)) {
      throw new InputError('You cannot invite this member.', 403);
    }
    const activity = enumField(req.body.activity, ACTIVITIES, 'activity');
    const location = enumField(req.body.location, LOCATIONS, 'meeting place');
    const date = req.body.date;
    const weekday = weekdayForDate(date);
    if (!Number.isInteger(req.body.day) || req.body.day !== weekday) {
      throw new InputError('The date must match the selected day of the week.');
    }
    const start = timeToMinutes(req.body.start);
    const end = timeToMinutes(req.body.end);
    if (end - start < 30) throw new InputError('A workout must last at least 30 minutes.');
    const now = chicagoNow();
    if (date < now.date || (date === now.date && start <= now.minutes)) {
      throw new InputError('Choose a future workout time.');
    }
    const maxDate = new Date(`${now.date}T12:00:00Z`);
    maxDate.setUTCFullYear(maxDate.getUTCFullYear() + 1);
    if (date > maxDate.toISOString().slice(0, 10)) {
      throw new InputError('Choose a workout within the next year.');
    }
    const note = req.body.note === undefined ? '' : textField(req.body.note, 'Message', { max: 240 });
    const details = matchDetails(matchProfile(req.user), matchProfile(candidate), slotsFor(req.user.id), slotsFor(candidate.id));
    if (!details || !details.sharedActivities.includes(activity) || !details.sharedLocations.includes(location)
      || !details.overlaps.some(slot => slot.day === weekday
        && start >= timeToMinutes(slot.start) && end <= timeToMinutes(slot.end))) {
      throw new InputError('This workout is outside your shared activities, places, or available times.');
    }
    if (conflicts(req.user.id, date, req.body.start, req.body.end)
      || conflicts(candidate.id, date, req.body.start, req.body.end)) {
      throw new InputError('One of you already has a workout planned for that time.', 409);
    }
    const nowMs = Date.now();
    const since = new Date(nowMs - DAY_MS).toISOString();
    const sentToday = db.prepare('SELECT COUNT(*) AS total FROM meetups WHERE from_user_id = ? AND created_at >= ?')
      .get(req.user.id, since).total;
    const sentToStudentToday = db.prepare(`SELECT COUNT(*) AS total FROM meetups
      WHERE from_user_id = ? AND to_user_id = ? AND created_at >= ?`)
      .get(req.user.id, targetId, since).total;
    if (sentToday >= MAX_MEETUPS_PER_DAY || sentToStudentToday >= MAX_MEETUPS_TO_ONE_STUDENT_PER_DAY) {
      throw new InputError('You have sent the daily limit of workout invitations. Try again tomorrow.', 429);
    }
    const createdAt = new Date(nowMs).toISOString();
    const result = db.prepare(`INSERT INTO meetups
      (from_user_id, to_user_id, activity, date, day, start, end, location, note, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(req.user.id, targetId, activity, date, weekday, req.body.start, req.body.end, location, note, createdAt);
    const row = db.prepare(`${meetupSelect} WHERE m.id = ?`).get(result.lastInsertRowid);
    res.status(201).json({ meetup: meetupFor(row) });
  } catch (error) { next(error); }
});

app.patch('/api/meetups/:id', requireAuth, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1 || !hasOnlyKeys(req.body, ['status'])) {
      throw new InputError('Choose a valid meetup and response.');
    }
    const status = enumField(req.body.status, ['accepted', 'declined', 'cancelled'], 'response');
    const row = db.prepare('SELECT * FROM meetups WHERE id = ?').get(id);
    if (!row || (row.from_user_id !== req.user.id && row.to_user_id !== req.user.id)) {
      throw new InputError('Meetup not found.', 404);
    }
    if (!trustedUser(row.from_user_id) || !trustedUser(row.to_user_id)) {
      throw new InputError('Meetup not found.', 404);
    }
    if (status === 'accepted' || status === 'declined') {
      if (req.user.id !== row.to_user_id || row.status !== 'pending') {
        throw new InputError('Only the invited member can accept or decline a pending invitation.', 403);
      }
      if (status === 'accepted') {
        // Another accepted workout can appear after the invitation was sent.
        const acceptedConflict = db.prepare(`SELECT 1 FROM meetups WHERE id != ? AND date = ?
          AND status = 'accepted' AND start < ? AND end > ?
          AND (from_user_id IN (?, ?) OR to_user_id IN (?, ?)) LIMIT 1`)
          .get(id, row.date, row.end, row.start, row.from_user_id, row.to_user_id, row.from_user_id, row.to_user_id);
        if (acceptedConflict) throw new InputError('One of you already has a confirmed workout at that time.', 409);
      }
    } else if (!['pending', 'accepted'].includes(row.status)) {
      throw new InputError('This meetup can no longer be cancelled.', 409);
    }
    db.prepare('UPDATE meetups SET status = ? WHERE id = ?').run(status, id);
    res.json({ meetup: meetupFor(db.prepare(`${meetupSelect} WHERE m.id = ?`).get(id)) });
  } catch (error) { next(error); }
});

const imagePreviewAttempts = new Map();
function limitImagePreviews(req, res, next) {
  const file = req.file;
  if (!process.env.OPENAI_API_KEY || !file || !(/\.(png|jpe?g|webp)$/i.test(file.originalname || '')
    || String(file.mimetype || '').startsWith('image/'))) return next();
  const key = `${req.user.id}:${req.ip}`;
  const now = Date.now();
  const recent = (imagePreviewAttempts.get(key) || []).filter(time => now - time < 60 * 60 * 1000);
  if (recent.length >= 8) return next(new InputError('Too many screenshot previews. Try again in an hour.', 429));
  recent.push(now);
  imagePreviewAttempts.set(key, recent);
  next();
}

app.post('/api/import/preview', requireAuth, upload.single('file'), limitImagePreviews, wrap(async (req, res) => {
  const result = await previewImport(req.file);
  res.json(result);
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

const clientDist = path.join(projectDir, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false }));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Uploads must be under 10 MB.' : 'Upload one schedule file at a time.';
    return res.status(400).json({ error: message });
  }
  if (error instanceof InputError) return res.status(error.status).json({ error: error.message });
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON.' });
  if (req.path === '/api/import/preview' && error instanceof Error) {
    return res.status(400).json({ error: error.message });
  }
  console.error('Server error:', error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  app.listen(port, () => console.log(`UIUC Gym Buddy App is running at http://localhost:${port}`));
}
