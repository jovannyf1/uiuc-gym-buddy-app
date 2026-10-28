import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const originalFetch = globalThis.fetch;
const geminiRequests = [];
let geminiResponse = { candidates: [{ content: { parts: [{ text: 'Tap My availability, then choose Add time.' }] } }] };
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
    geminiRequests.push({ url: String(input), init });
    return new Response(JSON.stringify(geminiResponse), {
      status: geminiResponse.httpStatus || 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return originalFetch(input, init);
};

process.env.NODE_ENV = 'production';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.EMAIL_FROM = 'Gym Buddy <hello@example.com>';
process.env.PUBLIC_APP_URL = 'https://gym-buddy.example.com/';
process.env.GEMINI_API_KEY = '';
process.env.GEMINI_MODEL = 'gemini-2.5-flash-lite';
const dataDir = mkdtempSync(path.join(tmpdir(), 'gym-buddy-assistant-'));
process.env.DATA_DIR = dataDir;
const { app, db } = await import('./index.js');
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
  globalThis.fetch = originalFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

async function request(endpoint, { body, cookie, method } = {}) {
  const response = await originalFetch(`${base}${endpoint}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function register(name, email) {
  const result = await request('/api/auth/email/register', {
    body: { name, username: name.toLowerCase().replace(/[^a-z0-9_]/g, '_'), email, password: 'assistant-test-password' },
  });
  assert.equal(result.status, 201);
  return result.cookie;
}

test('assistant requires sign-in, keeps its guide available without Gemini, and sends only the question to Gemini', async () => {
  assert.equal((await request('/api/assistant/config')).status, 401);
  assert.equal((await request('/api/assistant', { body: { question: 'How do I add times?' } })).status, 401);
  const cookie = await register('Helper Student', 'helper@example.org');

  assert.deepEqual((await request('/api/assistant/config', { cookie })).body, { available: false });
  const unavailable = await request('/api/assistant', { cookie, body: { question: 'How do I add times?' } });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body.error, /guide still works/i);
  assert.equal(geminiRequests.length, 0);

  process.env.GEMINI_API_KEY = 'test-gemini-key';
  assert.deepEqual((await request('/api/assistant/config', { cookie })).body, { available: true });
  assert.equal((await request('/api/assistant', { cookie, body: { question: '' } })).status, 400);
  assert.equal((await request('/api/assistant', { cookie, body: { question: 'x'.repeat(601) } })).status, 400);
  assert.equal((await request('/api/assistant', { cookie, body: { question: 'help', profile: 'private' } })).status, 400);

  const answer = await request('/api/assistant', { cookie, body: { question: 'How do I add free times?' } });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { answer: 'Tap My availability, then choose Add time.' });
  assert.equal(geminiRequests.length, 1);
  const sent = geminiRequests[0];
  assert.equal(sent.init.headers['x-goog-api-key'], 'test-gemini-key');
  assert.equal(new URL(sent.url).search, '', 'the API key is not placed in the URL');
  const payload = JSON.parse(sent.init.body);
  assert.equal(payload.contents.length, 1);
  assert.equal(payload.contents[0].parts[0].text, 'How do I add free times?');
  assert.equal(payload.generationConfig.maxOutputTokens, 384);
  assert.match(payload.systemInstruction.parts[0].text, /NetID and live Outlook sync are not available/);
  assert.doesNotMatch(JSON.stringify(payload), /helper@example\.org|assistant-test-password/);

  geminiResponse = { httpStatus: 429 };
  const providerLimit = await request('/api/assistant', { cookie, body: { question: 'Another question' } });
  assert.equal(providerLimit.status, 503);
  assert.match(providerLimit.body.error, /busy right now/i);
  geminiResponse = { candidates: [] };
  const empty = await request('/api/assistant', { cookie, body: { question: 'What should I tap next?' } });
  assert.equal(empty.status, 503);
  assert.match(empty.body.error, /rephrasing/i);
});

test('assistant has a database-backed per-account hourly question limit', async () => {
  geminiResponse = { candidates: [{ content: { parts: [{ text: 'A short answer.' }] } }] };
  const cookie = await register('Limit Student', 'limit@example.org');
  let status = 0;
  for (let i = 0; i < 12; i += 1) {
    status = (await request('/api/assistant', { cookie, body: { question: `Question ${i}` } })).status;
    assert.equal(status, 200);
  }
  const limited = await request('/api/assistant', { cookie, body: { question: 'One too many' } });
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /hourly question limit/i);
});
