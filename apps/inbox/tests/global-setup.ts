import { Client } from 'pg';
import { runMigrations } from '../scripts/migrate';

/** Recreates the test database from scratch, then migrates it. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://localhost/hailbox_test');
  const name = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`drop database if exists "${name}" with (force)`);
  await client.end();
  await runMigrations(url.toString());
}
