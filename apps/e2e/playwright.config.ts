import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  'postgresql://zerodue:zerodue@localhost:5432/zerodue_test?schema=public';
const inCI = Boolean(process.env.CI);
// Locally, PW_CHANNEL=chrome reuses the installed Chrome instead of downloading a browser.
const channel = process.env.PW_CHANNEL || undefined;

/**
 * Drives the real web app against the real API and a real database. Build first (`pnpm build`) and
 * apply the migrations to the database named above (`prisma migrate deploy`).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: inCI ? 2 : undefined,
  retries: inCI ? 1 : 0,
  reporter: inCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
    acceptDownloads: true,
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
  ],
  webServer: [
    {
      command: 'node apps/api/dist/main',
      cwd: '../..',
      url: `${API}/health`,
      reuseExistingServer: !inCI,
      timeout: 60_000,
      env: {
        PORT: '4000',
        DATABASE_URL,
        WEB_ORIGIN: WEB,
        JWT_ACCESS_SECRET: 'e2e-access-secret-not-for-production-0000000000',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-not-for-production-000000000',
        SCHEDULER: 'false',
        AUTH_RATE_LIMIT: '10000',
        ALLOW_SIGNUP: 'true',
      },
    },
    {
      command: 'pnpm --filter @zerodue/web start',
      cwd: '../..',
      url: `${WEB}/login`,
      reuseExistingServer: !inCI,
      timeout: 60_000,
    },
  ],
});
