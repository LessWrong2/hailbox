import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the demo site (as a visitor) and the inbox (as an operator) in real
 * browsers. They reuse dev servers that are already running on :3000/:3001, or start them.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
    // Uses the locally installed Chrome, so no browser download is needed.
    ...devices['Desktop Chrome'],
    channel: 'chrome',
  },
  webServer: [
    {
      command: 'pnpm -C apps/inbox dev',
      url: 'http://localhost:3000/login',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm -C apps/demo dev',
      url: 'http://localhost:3001',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
