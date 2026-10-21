const { test, expect } = require('@playwright/test');

// A real device condition, not a theoretical one: private browsing on some
// browsers, a WebView with storage disabled, or a device policy that blocks
// site storage all make `localStorage.getItem`/`setItem` throw a
// SecurityError instead of just returning null. The very first script line
// read `localStorage.getItem('_dk')` with no try/catch, before #app ever
// renders — so on a blocked device the whole app died silently: no splash
// screen, no error the user could act on, nothing. The page's own
// window.addEventListener('error',...) handler can't rescue this either,
// since it reports to `db`, which doesn't exist yet at that point.
//
// This test blocks storage the same way a real browser does — by making the
// accessors throw — and asserts the app still boots.

test.describe('the app survives localStorage being blocked', () => {
  test('boots and renders the splash screen even when storage throws', async ({ page }) => {
    await page.addInitScript(() => {
      const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', {
        get() { return { getItem: blocked, setItem: blocked, removeItem: blocked }; },
      });
    });

    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push('pageerror: ' + err.message));

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app')).not.toBeEmpty();
    await expect(page.getByText('הצטרף עכשיו')).toBeVisible();

    expect(jsErrors, 'app must not crash when storage is blocked:\n' + jsErrors.join('\n')).toEqual([]);
  });

  test('toggling dark mode does not throw when storage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', {
        get() { return { getItem: blocked, setItem: blocked, removeItem: blocked }; },
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(() => {
      try { toggleDarkMode(); return 'ok'; } catch (e) { return 'threw: ' + e.message; }
    });
    expect(result).toBe('ok');
  });
});
