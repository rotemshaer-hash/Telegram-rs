const { test, expect } = require('@playwright/test');

// First pass of the automated test suite (Phase 0 of the scaling roadmap).
// Goal right now is narrow on purpose: catch the "app is completely broken"
// class of regression (JS syntax error, render() throwing, blank screen)
// automatically on every push, using the real index.html against mocked
// Firebase/EmailJS. Deeper flow coverage (registration, chat, booking)
// comes next once this baseline is green in CI.

test.describe('Drushe smoke tests', () => {
  test('app boots with no JS errors and renders the splash screen', async ({ page }) => {
    // Uncaught exceptions always fail the test. Console "Failed to load
    // resource" noise (fonts/images/analytics beacons) is excluded — it's a
    // network-conditions signal, not proof the app's own code is broken.
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/Failed to load resource/i.test(msg.text())) {
        jsErrors.push('console.error: ' + msg.text());
      }
    });

    // domcontentloaded, not the default 'load' — the page pulls in external
    // fonts/analytics/QR-code images that are irrelevant to whether the app
    // itself booted, and waiting on them made this flaky on slow networks.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect(page.getByText('הצטרף עכשיו')).toBeVisible();

    expect(jsErrors, 'Unexpected JS errors on boot:\n' + jsErrors.join('\n')).toEqual([]);
  });

  test('guest browsing reaches the home screen', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('[onclick="browseAsGuest()"]').click();
    await expect(page.locator('#app')).toContainText('Drushe', { timeout: 10000 });
  });

  test('login screen is reachable and has email/password fields', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByText('כבר רשום? התחבר').click();
    await expect(page.locator('#app')).not.toBeEmpty();
  });
});
