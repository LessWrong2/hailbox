import { attachDatabasePool } from '@vercel/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { databaseUrl } from '../env';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

// Survive Next.js dev-mode module reloading without leaking pools.
const globalForDb = globalThis as typeof globalThis & { __hailboxDb?: { pool: Pool; db: Database } };

function create() {
  // Fail fast rather than queueing forever when the database is unreachable or saturated.
  const pool = new Pool({ connectionString: databaseUrl(), max: 10, connectionTimeoutMillis: 5_000 });
  // On Vercel Fluid compute, closes idle connections before the instance suspends.
  attachDatabasePool(pool);
  return { pool, db: drizzle(pool, { schema }) };
}

export function getPool(): Pool {
  globalForDb.__hailboxDb ??= create();
  return globalForDb.__hailboxDb.pool;
}

export function getDb(): Database {
  globalForDb.__hailboxDb ??= create();
  return globalForDb.__hailboxDb.db;
}

export async function closeDb(): Promise<void> {
  const current = globalForDb.__hailboxDb;
  globalForDb.__hailboxDb = undefined;
  await current?.pool.end();
}

export { schema };
