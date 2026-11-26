// @ts-check
import fs from 'fs';
import { defineConfig, devices } from '@playwright/test';

const LOCAL_CHROMIUM = process.env.E2E_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Sandbox-local Chromium if present; otherwise Playwright's own (CI runs `playwright install chromium`).
        launchOptions: {
          ...(fs.existsSync(LOCAL_CHROMIUM) ? { executablePath: LOCAL_CHROMIUM } : {}),
          args: ['--no-sandbox'],
        },
      },
    },
  ],
  // We start backend + portal dev servers ourselves before running tests.
});
