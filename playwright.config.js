const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/serve-test-app.js',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  // Drushe is mobile-only by design (it shows a "use your phone" overlay
  // above 768px width) — emulate a phone so the app actually renders.
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
