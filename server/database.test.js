import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './database.js';

test('Vercel refuses to start without the persistent Supabase database', async () => {
  const originalUrl = process.env.SUPABASE_DATABASE_URL;
  const originalVercel = process.env.VERCEL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  delete process.env.SUPABASE_DATABASE_URL;
  process.env.VERCEL = '1';
  delete process.env.VERCEL_ENV;
  try {
    await assert.rejects(createDatabase(), /SUPABASE_DATABASE_URL is required on Vercel/);
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_DATABASE_URL;
    else process.env.SUPABASE_DATABASE_URL = originalUrl;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
});
