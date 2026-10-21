import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool, types } = pg;
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(serverDir);
const transactionClient = new AsyncLocalStorage();

// JavaScript timestamps are safely below 2^53, so parse PostgreSQL BIGINTs as
// numbers to preserve the shape used by the SQLite development database.
types.setTypeParser(20, value => Number(value));

export function postgresSql(sql) {
  const portable = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, match => match.replace(/OR\s+IGNORE\s+/i, ''));
  let index = 0;
  return portable.replace(/\?/g, () => `$${++index}`);
}

class SQLiteDatabase {
  kind = 'sqlite';

  constructor(filename) {
    this.raw = new DatabaseSync(filename);
  }

  prepare(sql) {
    return this.raw.prepare(sql);
  }

  exec(sql) {
    return this.raw.exec(sql);
  }

  async transaction(work) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = await work();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.raw.close();
  }
}

class PostgresDatabase {
  kind = 'postgres';

  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX) || 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 8_000,
      allowExitOnIdle: true,
    });
  }

  query(sql, params = []) {
    const client = transactionClient.getStore();
    return (client || this.pool).query(sql, params);
  }

  prepare(sql) {
    const wasIgnore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql);
    const baseSql = postgresSql(sql);
    const insertTable = /^\s*INSERT\s+INTO\s+(users|meetups|chat_messages)\b/i.exec(baseSql)?.[1];
    return {
      get: async (...params) => (await this.query(baseSql, params)).rows[0],
      all: async (...params) => (await this.query(baseSql, params)).rows,
      run: async (...params) => {
        let runSql = baseSql;
        if (wasIgnore && !/\bON\s+CONFLICT\b/i.test(runSql)) runSql += ' ON CONFLICT DO NOTHING';
        const returningId = insertTable && !wasIgnore && !/\bRETURNING\b/i.test(runSql);
        if (returningId) runSql += ' RETURNING id';
        const result = await this.query(runSql, params);
        return {
          changes: result.rowCount,
          ...(returningId && result.rows[0] ? { lastInsertRowid: result.rows[0].id } : {}),
        };
      },
    };
  }

  exec(sql) {
    return this.query(sql);
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      return await transactionClient.run(client, async () => {
        try {
          const result = await work();
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    } finally {
      client.release();
    }
  }

  async migrate() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize cold-start migrations across Vercel instances. A transaction
      // advisory lock also works with Supabase's transaction pooler.
      await client.query('SELECT pg_advisory_xact_lock(7010142101::bigint)');
      await client.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      )`);
      await client.query('ALTER TABLE app_schema_migrations ENABLE ROW LEVEL SECURITY');
      const directory = path.join(projectDir, 'supabase', 'migrations');
      const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
      for (const name of files) {
        const existing = await client.query('SELECT 1 FROM app_schema_migrations WHERE name = $1', [name]);
        if (existing.rowCount) continue;
        const migration = await readFile(path.join(directory, name), 'utf8');
        await client.query(migration);
        await client.query('INSERT INTO app_schema_migrations (name, applied_at) VALUES ($1, $2)', [name, Date.now()]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

export async function createDatabase({ sqlitePath } = {}) {
  const connectionString = process.env.SUPABASE_DATABASE_URL;
  if (connectionString) {
    const database = new PostgresDatabase(connectionString);
    await database.migrate();
    return database;
  }

  if (process.env.VERCEL === '1' || process.env.VERCEL_ENV) {
    throw new Error('SUPABASE_DATABASE_URL is required on Vercel. Add the Supabase transaction-pooler URI to the project environment variables.');
  }

  const filename = sqlitePath || path.join(projectDir, 'data', 'app.db');
  await mkdir(path.dirname(filename), { recursive: true });
  return new SQLiteDatabase(filename);
}
