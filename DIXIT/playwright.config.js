// @ts-check
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js$/,
  timeout: 60000,
  use: {
    headless: true,
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 720 }
  },
  webServer: {
    command: 'node server.js',
    env: {
      ...process.env,
      PORT: '3000',
    },
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 20000,
  },
});
