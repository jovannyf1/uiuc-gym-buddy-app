import { createHash } from 'node:crypto';
import { InputError } from './core.js';

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const QUESTION_LIMIT = 600;
const ANSWER_LIMIT = 2_000;
const QUESTIONS_PER_HOUR = 12;
const HOUR_MS = 60 * 60 * 1_000;

const APP_GUIDE = `You are Buddy Help inside UIUC Gym Buddy App. Be warm, brief, and practical.
Explain how this app works when asked: members edit a profile and choose activities and ARC or CRCE; they add weekly free times manually or import an .ics calendar export. A schedule screenshot can suggest free times only if the separate screenshot AI service is configured. Imported times must be reviewed before saving. Find a buddy shows compatible people with overlapping free times, activities, and gyms. Members can chat, invite someone to a dated workout, and accept, decline, or cancel invitations. Working out now is opt-in and expires. Members can block and report others. Email verification is optional to use the app but required for password reset. Email and username are unique; sign-in uses email. NetID and live Outlook sync are not available.
Answer general workout questions if helpful, but never invent the user's schedule, matches, messages, gym crowd, campus hours, or current app state. You cannot view or change their account or send messages. For current campus facts, suggest checking an official UIUC source. Do not diagnose injuries or prescribe medical treatment. If asked for help using the app, give a concrete next tap or step. Do not ask for passwords, verification links, or private schedule details.`;

function modelName() {
  const configured = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  if (!/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(configured)) {
    throw new Error('GEMINI_MODEL must be a model name, such as gemini-2.5-flash-lite.');
  }
  return configured;
}

async function useQuestionAllowance(db, userId) {
  const now = Date.now();
  const key = createHash('sha256').update(`assistant-user:${userId}`).digest('hex');
  // One atomic statement works with both SQLite and PostgreSQL, including
  // concurrent serverless requests, and avoids storing the question itself.
  const allowed = await db.prepare(`INSERT INTO email_auth_limits (key, count, window_end)
    VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN email_auth_limits.window_end <= ? THEN 1 ELSE email_auth_limits.count + 1 END,
      window_end = CASE WHEN email_auth_limits.window_end <= ? THEN excluded.window_end ELSE email_auth_limits.window_end END
    WHERE email_auth_limits.window_end <= ? OR email_auth_limits.count < ?
    RETURNING count`).get(key, now + HOUR_MS, now, now, now, QUESTIONS_PER_HOUR);
  if (!allowed) throw new InputError('You have reached the hourly question limit. Try again later.', 429);
}

export function registerAssistantRoutes({ app, db, requireAuth, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  app.get('/api/assistant/config', requireAuth, (_req, res) => {
    res.json({ available: Boolean(process.env.GEMINI_API_KEY?.trim()) });
  });

  app.post('/api/assistant', requireAuth, handle(async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new InputError('AI answers are not set up yet. The app guide still works.', 503);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some(key => key !== 'question')) {
      throw new InputError('Enter a question.');
    }
    const question = typeof req.body.question === 'string' ? req.body.question.trim() : '';
    if (!question || question.length > QUESTION_LIMIT) {
      throw new InputError(`Use a question of 1–${QUESTION_LIMIT} characters.`);
    }
    await useQuestionAllowance(db, req.user.id);

    const model = modelName();
    let response;
    try {
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: APP_GUIDE }] },
          contents: [{ role: 'user', parts: [{ text: question }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 384, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new InputError('AI answers are unavailable right now. Please try again later.', 503);
    }
    if (!response.ok) {
      console.error('Gemini answer request failed:', response.status);
      throw new InputError(response.status === 429
        ? 'AI answers are busy right now. Please try again later.'
        : 'AI answers are unavailable right now. Please try again later.', 503);
    }
    let result;
    try { result = await response.json(); } catch {
      throw new InputError('AI answers are unavailable right now. Please try again later.', 503);
    }
    const answer = result?.candidates?.[0]?.content?.parts
      ?.map(part => typeof part.text === 'string' ? part.text : '').join('').trim();
    if (!answer) throw new InputError('AI could not answer that question. Please try rephrasing it.', 503);
    res.json({ answer: answer.slice(0, ANSWER_LIMIT) });
  }));
}
