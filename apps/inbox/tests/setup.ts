import { afterAll, afterEach, beforeEach, vi } from 'vitest';
import { flushBackground } from '@/server/background';
import { closeDb, getPool } from '@/server/db';

const ENV_KEYS = [
  'OPERATOR_EMAILS',
  'MAILGUN_API_KEY',
  'MAILGUN_DOMAIN',
  'MAILGUN_FROM',
  'SLACK_BOT_TOKEN',
  'SLACK_CHANNEL_ID',
  'SLACK_WEBHOOK_URL',
  'HAILBOX_ALLOWED_ORIGINS',
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.NOTIFY_DELAY_SECONDS = '0';
  await getPool().query(
    'truncate visitors, conversations, messages, operators, login_tokens, sessions restart identity cascade',
  );
});

afterEach(async () => {
  await flushBackground();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await closeDb();
});
