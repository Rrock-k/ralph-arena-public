import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const readyURL = process.env.PLAYWRIGHT_READY_URL || `${baseURL}/api/test/ready`;
const shouldStartWebServer = process.env.PLAYWRIGHT_USE_EXTERNAL_SERVER !== '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: shouldStartWebServer
    ? {
        command: 'node scripts/start-playwright-dev.mjs',
        url: readyURL,
        reuseExistingServer: false,
        timeout: 120000,
      }
    : undefined,
});
