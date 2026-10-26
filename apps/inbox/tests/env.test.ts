import { afterEach, describe, expect, it, vi } from 'vitest';
import { directDatabaseUrl } from '@/server/env';

describe('directDatabaseUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('prefers DATABASE_URL_UNPOOLED', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/db');
    vi.stubEnv('DATABASE_URL_UNPOOLED', 'postgres://u:p@direct.example.com/db');
    expect(directDatabaseUrl()).toBe('postgres://u:p@direct.example.com/db');
  });

  it("drops the pooler from a Neon pooled DATABASE_URL, since LISTEN doesn't work through it", () => {
    vi.stubEnv('DATABASE_URL', 'postgres://u:p%40ss@ep-cool-123-pooler.us-east-2.aws.neon.tech/db?sslmode=require');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    expect(directDatabaseUrl()).toBe('postgres://u:p%40ss@ep-cool-123.us-east-2.aws.neon.tech/db?sslmode=require');
  });

  it('otherwise uses DATABASE_URL as is', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/hailbox_test');
    vi.stubEnv('DATABASE_URL_UNPOOLED', '');
    expect(directDatabaseUrl()).toBe('postgres://localhost/hailbox_test');
  });
});
