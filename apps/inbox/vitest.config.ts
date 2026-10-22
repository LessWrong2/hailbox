import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globalSetup: './tests/global-setup.ts',
    setupFiles: ['./tests/setup.ts'],
    // Tests share one database.
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://localhost/hailbox_test',
      NOTIFY_DELAY_SECONDS: '0',
      HAILBOX_INBOX_URL: 'https://inbox.test',
      HAILBOX_SITE_NAME: 'Acme',
    },
  },
});
