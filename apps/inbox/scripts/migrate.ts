/**
 * Applies pending migrations from ./drizzle. Run during deploys (see vercel.json) and locally
 * with `pnpm db:migrate`. Against a local server, creates the database if it doesn't exist.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { databaseUrl } from '../src/server/env';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

async function ensureLocalDatabase(url: string) {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return;
  const name = decodeURIComponent(parsed.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) {
      await client.query(`create database "${name.replace(/"/g, '""')}"`);
      console.log(`Created database ${name}`);
    }
  } finally {
    await client.end();
  }
}

export async function runMigrations(url = databaseUrl()) {
  await ensureLocalDatabase(url);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Locally, use the same env files `next dev` reads (e.g. from `vercel env pull .env.local`).
  if (!process.env.VERCEL) {
    for (const file of ['.env.local', '.env']) {
      try {
        process.loadEnvFile(fileURLToPath(new URL(`../${file}`, import.meta.url)));
      } catch {
        // No such file.
      }
    }
  }
  const vercelEnv = process.env.VERCEL_ENV;
  // Preview builds may share production's database; a PR's migration shouldn't run against it.
  // With per-preview database branches (e.g. Neon's integration), set HAILBOX_MIGRATE_PREVIEWS=1.
  if (vercelEnv && vercelEnv !== 'production' && process.env.HAILBOX_MIGRATE_PREVIEWS !== '1') {
    console.log(`Skipping migrations for a ${vercelEnv} build (set HAILBOX_MIGRATE_PREVIEWS=1 to run them).`);
    process.exit(0);
  }
  if (process.env.VERCEL && !process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Connect a Postgres database to this Vercel project first.');
    process.exit(1);
  }
  await runMigrations();
  console.log('Migrations applied.');
}
