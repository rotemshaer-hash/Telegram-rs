const { test, expect } = require('@playwright/test');

// Guards the root cause behind the "black screen, feels like it's before
// login" report (HANDOFF.md, 20.8.2026 / resolved 24.8.2026): reaching
// Discover's loading screen requires an authenticated session, and the
// splash screen is always the first thing a fresh boot renders. A future
// change that adds another go('discover') call site, or that lets Discover
// render without currentUser, must fail this test -- not get discovered
// from a user's screenshot again.

test.describe('Discover feed cannot appear before login', () => {
  test('fresh boot renders the splash screen, never the discover loading state', async ({ page }) => {
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('הצטרף עכשיו')).toBeVisible();
    await expect(page.getByText('טוען דרילס')).toHaveCount(0);

    expect(jsErrors, 'Unexpected JS errors on boot:\n' + jsErrors.join('\n')).toEqual([]);
  });

  test('discover refuses to render without an authenticated session', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Simulates the kind of stray state a bug (bad back-button restore, a
    // second call site, ...) could put the app in: S.screen pointed at
    // 'discover' with nobody logged in. Discover() itself must still
    // refuse -- this is the guard that makes the whole report impossible,
    // independent of how someone got there.
    await page.evaluate(() => { S.screen = 'discover'; render(); });
    await expect(page.getByText('יש להתחבר כדי לצפות בדרילס')).toBeVisible();
    await expect(page.getByText('טוען דרילס')).toHaveCount(0);
  });

  test('guest browsing reaches home without ever showing the discover loading screen', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('[onclick="browseAsGuest()"]').click();
    await expect(page.locator('#app')).toContainText('Drushe', { timeout: 10000 });
    await expect(page.getByText('טוען דרילס')).toHaveCount(0);
  });
});
