import { ACTIVITIES, LOCATIONS, InputError } from './core.js';

const PRESENCE_MINUTES = 60;
const MAX_NEW_CHATS_PER_DAY = 10;
const MAX_MESSAGES_PER_HOUR = 60;
const MESSAGE_COOLDOWN_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function objectWithOnlyKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
}

function positiveId(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) {
    throw new InputError('Choose a valid student or chat.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new InputError('Choose a valid student or chat.');
  return id;
}

function publicProfile(row) {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    activities: JSON.parse(row.activities),
    experience: row.experience,
    locations: JSON.parse(row.locations),
    bio: row.bio,
  };
}

function compatibleProfiles(first, second) {
  const firstActivities = JSON.parse(first.activities);
  const secondActivities = JSON.parse(second.activities);
  const firstLocations = JSON.parse(first.locations);
  const secondLocations = JSON.parse(second.locations);
  const accepts = (preference, gender) => preference === 'any' || preference === gender;
  if (!accepts(first.partner_preference, second.gender)
    || !accepts(second.partner_preference, first.gender)) return null;
  const activities = firstActivities.filter(activity => secondActivities.includes(activity));
  const locations = firstLocations.filter(location => secondLocations.includes(location));
  return activities.length && locations.length ? { activities, locations } : null;
}

function presenceFor(row) {
  return row ? {
    activity: row.activity,
    location: row.location,
    expiresAt: new Date(row.expires_at).toISOString(),
  } : null;
}

function messageFor(row) {
  return row ? {
    id: row.id,
    senderUserId: row.sender_user_id,
    text: row.body,
    createdAt: row.created_at,
  } : null;
}

// Social data stays on the server. Only explicitly published, unexpired gym
// presence is discoverable; private weekly availability is never returned here.
export function registerSocialRoutes({ app, db, requireAuth }) {
  const netidOnly = [
    process.env.ILLINOIS_OIDC_ISSUER, process.env.ILLINOIS_OIDC_CLIENT_ID,
    process.env.ILLINOIS_OIDC_CLIENT_SECRET, process.env.ILLINOIS_OIDC_REDIRECT_URI,
  ].every(Boolean);
  db.exec(`
    CREATE TABLE IF NOT EXISTS workout_presence (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      activity TEXT NOT NULL,
      location TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workout_presence_expires ON workout_presence(expires_at);
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (blocker_user_id, blocked_user_id),
      CHECK (blocker_user_id != blocked_user_id)
    );
    CREATE TABLE IF NOT EXISTS user_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_reports_reporter_time ON user_reports(reporter_user_id, created_at_ms);
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      initiated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      UNIQUE (user_a_id, user_b_id),
      CHECK (user_a_id < user_b_id)
    );
    CREATE INDEX IF NOT EXISTS chats_initiator_time ON chats(initiated_by_user_id, created_at_ms);
    CREATE INDEX IF NOT EXISTS chats_user_a ON chats(user_a_id, updated_at_ms);
    CREATE INDEX IF NOT EXISTS chats_user_b ON chats(user_b_id, updated_at_ms);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_messages_chat_id ON chat_messages(chat_id, id);
    CREATE INDEX IF NOT EXISTS chat_messages_sender_time ON chat_messages(sender_user_id, created_at_ms);
  `);

  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const blocked = db.prepare(`SELECT 1 FROM user_blocks
    WHERE (blocker_user_id = ? AND blocked_user_id = ?)
       OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1`);
  const chatById = db.prepare('SELECT * FROM chats WHERE id = ?');
  const latestMessage = db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1');
  const deleteExpiredPresence = db.prepare('DELETE FROM workout_presence WHERE expires_at <= ?');
  deleteExpiredPresence.run(Date.now());

  function hasNetidIdentity(userId) {
    // netid_identities is initialized later in index.js, before requests run.
    return !netidOnly || Boolean(db.prepare('SELECT 1 FROM netid_identities WHERE user_id = ?').get(userId));
  }

  function requireNetidIdentity(userId) {
    if (!hasNetidIdentity(userId)) {
      throw new InputError('Illinois NetID sign-in is required.', 403);
    }
  }

  function isBlocked(firstId, secondId) {
    return Boolean(blocked.get(firstId, secondId, secondId, firstId));
  }

  function readableChat(chatId, userId) {
    const chat = chatById.get(chatId);
    if (!chat || (chat.user_a_id !== userId && chat.user_b_id !== userId)) {
      throw new InputError('Chat not found.', 404);
    }
    if (!hasNetidIdentity(chat.user_a_id) || !hasNetidIdentity(chat.user_b_id)) {
      throw new InputError('Chat not found.', 404);
    }
    return chat;
  }

  function chatFor(chat, userId) {
    const otherUserId = chat.user_a_id === userId ? chat.user_b_id : chat.user_a_id;
    return {
      id: chat.id,
      otherUser: publicProfile(userById.get(otherUserId)),
      lastMessage: messageFor(latestMessage.get(chat.id)),
      updatedAt: chat.updated_at,
    };
  }

  app.get('/api/presence/me', requireAuth, (req, res) => {
    requireNetidIdentity(req.user.id);
    const now = Date.now();
    deleteExpiredPresence.run(now);
    const row = db.prepare('SELECT * FROM workout_presence WHERE user_id = ? AND expires_at > ?')
      .get(req.user.id, now);
    res.json({ presence: presenceFor(row) });
  });

  app.put('/api/presence', requireAuth, (req, res, next) => {
    try {
      requireNetidIdentity(req.user.id);
      if (!objectWithOnlyKeys(req.body, ['activity', 'location', 'durationMinutes'])) {
        throw new InputError('Choose a gym and workout activity.');
      }
      const { activity, location } = req.body;
      const durationMinutes = req.body.durationMinutes ?? PRESENCE_MINUTES;
      if (!ACTIVITIES.includes(activity) || !LOCATIONS.includes(location)) {
        throw new InputError('Choose a valid gym and workout activity.');
      }
      if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 180) {
        throw new InputError('Choose a duration between 15 and 180 minutes.');
      }
      if (!JSON.parse(req.user.activities).includes(activity)
        || !JSON.parse(req.user.locations).includes(location)) {
        throw new InputError('Add this activity and gym to your profile first.');
      }
      const now = Date.now();
      deleteExpiredPresence.run(now);
      const expiresAt = now + durationMinutes * 60 * 1000;
      db.prepare(`INSERT INTO workout_presence (user_id, activity, location, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
        activity = excluded.activity, location = excluded.location,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
        .run(req.user.id, activity, location, expiresAt, now);
      res.json({ presence: presenceFor({ activity, location, expires_at: expiresAt }) });
    } catch (error) { next(error); }
  });

  app.delete('/api/presence', requireAuth, (req, res) => {
    db.prepare('DELETE FROM workout_presence WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  app.get('/api/presence/nearby', requireAuth, (req, res) => {
    requireNetidIdentity(req.user.id);
    const now = Date.now();
    deleteExpiredPresence.run(now);
    const people = [];
    const rows = db.prepare(`SELECT p.user_id, p.activity, p.location, p.expires_at
      FROM workout_presence p
      ${netidOnly ? 'JOIN netid_identities n ON n.user_id = p.user_id' : ''}
      WHERE p.user_id != ? AND p.expires_at > ?
      ORDER BY p.updated_at DESC LIMIT 200`).all(req.user.id, now);
    for (const row of rows) {
      if (isBlocked(req.user.id, row.user_id)) continue;
      const person = userById.get(row.user_id);
      if (!person) continue;
      const shared = compatibleProfiles(req.user, person);
      if (shared?.activities.includes(row.activity) && shared.locations.includes(row.location)) {
        people.push({ user: publicProfile(person), ...presenceFor(row) });
      }
    }
    res.json({ people });
  });

  app.get('/api/chats', requireAuth, (req, res) => {
    requireNetidIdentity(req.user.id);
    const rows = db.prepare(`SELECT c.* FROM chats c
      ${netidOnly ? `JOIN netid_identities a ON a.user_id = c.user_a_id
      JOIN netid_identities b ON b.user_id = c.user_b_id` : ''}
      WHERE c.user_a_id = ? OR c.user_b_id = ?
      ORDER BY c.updated_at_ms DESC, c.id DESC LIMIT 100`).all(req.user.id, req.user.id);
    const chats = rows.filter(row => !isBlocked(row.user_a_id, row.user_b_id))
      .map(row => chatFor(row, req.user.id));
    res.json({ chats });
  });

  app.post('/api/chats', requireAuth, (req, res, next) => {
    try {
      requireNetidIdentity(req.user.id);
      if (!objectWithOnlyKeys(req.body, ['toUserId'])) throw new InputError('Choose a student to chat with.');
      const targetId = positiveId(req.body.toUserId);
      if (targetId === req.user.id) throw new InputError('Choose another student to chat with.');
      const target = userById.get(targetId);
      if (!target || !hasNetidIdentity(targetId)) throw new InputError('This student is unavailable.', 404);
      if (isBlocked(req.user.id, targetId)) throw new InputError('You cannot contact this student.', 403);
      if (!compatibleProfiles(req.user, target)) {
        throw new InputError('You and this student need a shared activity and gym to chat.', 403);
      }
      const [firstId, secondId] = [req.user.id, targetId].sort((a, b) => a - b);
      const existing = db.prepare('SELECT * FROM chats WHERE user_a_id = ? AND user_b_id = ?')
        .get(firstId, secondId);
      if (existing) return res.json({ chat: chatFor(existing, req.user.id) });
      const nowMs = Date.now();
      const started = db.prepare(`SELECT COUNT(*) AS total FROM chats
        WHERE initiated_by_user_id = ? AND created_at_ms > ?`).get(req.user.id, nowMs - DAY_MS).total;
      if (started >= MAX_NEW_CHATS_PER_DAY) {
        throw new InputError('Too many new chats today. Try again later.', 429);
      }
      const now = new Date(nowMs).toISOString();
      db.prepare(`INSERT OR IGNORE INTO chats
        (user_a_id, user_b_id, initiated_by_user_id, created_at, created_at_ms, updated_at, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(firstId, secondId, req.user.id, now, nowMs, now, nowMs);
      const chat = db.prepare('SELECT * FROM chats WHERE user_a_id = ? AND user_b_id = ?')
        .get(firstId, secondId);
      res.status(201).json({ chat: chatFor(chat, req.user.id) });
    } catch (error) { next(error); }
  });

  app.get('/api/chats/:id/messages', requireAuth, (req, res, next) => {
    try {
      const chatId = positiveId(req.params.id);
      readableChat(chatId, req.user.id);
      const before = req.query.before === undefined ? Number.MAX_SAFE_INTEGER : positiveId(req.query.before);
      const rows = db.prepare(`SELECT * FROM chat_messages WHERE chat_id = ? AND id < ?
        ORDER BY id DESC LIMIT 100`).all(chatId, before);
      res.json({ messages: rows.reverse().map(messageFor) });
    } catch (error) { next(error); }
  });

  app.post('/api/chats/:id/messages', requireAuth, (req, res, next) => {
    try {
      const chatId = positiveId(req.params.id);
      const chat = readableChat(chatId, req.user.id);
      if (!objectWithOnlyKeys(req.body, ['text']) || typeof req.body.text !== 'string') {
        throw new InputError('Write a message to send.');
      }
      const text = req.body.text.trim();
      if (text.length < 1 || text.length > 1000) {
        throw new InputError('Messages must be between 1 and 1000 characters.');
      }
      const otherUserId = chat.user_a_id === req.user.id ? chat.user_b_id : chat.user_a_id;
      if (isBlocked(req.user.id, otherUserId)) throw new InputError('You cannot contact this student.', 403);
      if (!compatibleProfiles(req.user, userById.get(otherUserId))) {
        throw new InputError('You and this student no longer have a shared activity and gym.', 403);
      }
      const nowMs = Date.now();
      const recent = db.prepare(`SELECT created_at_ms FROM chat_messages
        WHERE sender_user_id = ? ORDER BY created_at_ms DESC LIMIT 1`).get(req.user.id);
      if (recent && nowMs - recent.created_at_ms < MESSAGE_COOLDOWN_MS) {
        throw new InputError('Please wait a moment before sending another message.', 429);
      }
      const hourly = db.prepare(`SELECT COUNT(*) AS total FROM chat_messages
        WHERE sender_user_id = ? AND created_at_ms > ?`).get(req.user.id, nowMs - HOUR_MS).total;
      if (hourly >= MAX_MESSAGES_PER_HOUR) {
        throw new InputError('Too many messages this hour. Try again later.', 429);
      }
      const now = new Date(nowMs).toISOString();
      const result = db.prepare(`INSERT INTO chat_messages
        (chat_id, sender_user_id, body, created_at, created_at_ms) VALUES (?, ?, ?, ?, ?)`)
        .run(chatId, req.user.id, text, now, nowMs);
      db.prepare('UPDATE chats SET updated_at = ?, updated_at_ms = ? WHERE id = ?')
        .run(now, nowMs, chatId);
      res.status(201).json({ message: messageFor(db.prepare('SELECT * FROM chat_messages WHERE id = ?')
        .get(result.lastInsertRowid)) });
    } catch (error) { next(error); }
  });

  app.post('/api/users/:id/block', requireAuth, (req, res, next) => {
    try {
      const targetId = positiveId(req.params.id);
      if (targetId === req.user.id || !userById.get(targetId)) {
        throw new InputError('Choose another student to block.');
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT OR IGNORE INTO user_blocks
          (blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, ?)`)
          .run(req.user.id, targetId, new Date().toISOString());
        db.prepare(`UPDATE meetups SET status = 'cancelled'
          WHERE status IN ('pending', 'accepted') AND
            ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`)
          .run(req.user.id, targetId, targetId, req.user.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      res.json({ blocked: true });
    } catch (error) { next(error); }
  });

  app.get('/api/blocks', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT u.* FROM user_blocks b
      JOIN users u ON u.id = b.blocked_user_id
      WHERE b.blocker_user_id = ? ORDER BY u.name, u.id`).all(req.user.id);
    res.json({ blockedUsers: rows.filter(row => hasNetidIdentity(row.id)).map(publicProfile) });
  });

  app.delete('/api/users/:id/block', requireAuth, (req, res, next) => {
    try {
      const targetId = positiveId(req.params.id);
      db.prepare('DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?')
        .run(req.user.id, targetId);
      res.json({ blocked: false });
    } catch (error) { next(error); }
  });

  app.post('/api/users/:id/report', requireAuth, (req, res, next) => {
    try {
      const targetId = positiveId(req.params.id);
      if (targetId === req.user.id || !userById.get(targetId)) {
        throw new InputError('Choose another student to report.');
      }
      if (!objectWithOnlyKeys(req.body, ['reason', 'details'])
        || !['harassment', 'spam', 'unsafe', 'other'].includes(req.body.reason)) {
        throw new InputError('Choose a reason for the report.');
      }
      const details = req.body.details ?? '';
      if (typeof details !== 'string' || details.trim().length > 500) {
        throw new InputError('Report details must be under 500 characters.');
      }
      const nowMs = Date.now();
      const recent = db.prepare(`SELECT 1 FROM user_reports
        WHERE reporter_user_id = ? AND reported_user_id = ? AND created_at_ms > ? LIMIT 1`)
        .get(req.user.id, targetId, nowMs - DAY_MS);
      if (recent) throw new InputError('You have already reported this student today.', 429);
      db.prepare(`INSERT INTO user_reports
        (reporter_user_id, reported_user_id, reason, details, created_at, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, targetId, req.body.reason, details.trim(), new Date(nowMs).toISOString(), nowMs);
      res.status(201).json({ reported: true });
    } catch (error) { next(error); }
  });
}
