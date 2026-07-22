const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  // The app is a ~1MB single-file bundle — parsing/executing it under
  // parallel-worker CPU contention can genuinely take longer than the
  // 5s assertion default, especially on a shared/constrained runner.
  // That's a slow first paint, not the app being broken, so give
  // assertions real headroom instead of chasing config-level flakiness.
  expect: { timeout: 12000 },
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
