const { test, expect } = require('@playwright/test');

// A teacher whose trial ended is routed to the subscribe screen from every other
// screen (render()'s guard), so they could not reach account deletion either. The
// subscribe screen now carries it, in the web and the native variants.

test('an expired teacher can delete their account from the subscribe screen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Subscribe === 'function');
  const r = await page.evaluate(() => {
    currentUser = { uid: 't', email: 't@example.com', emailVerified: true };
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    const web = Subscribe();
    const nativeBefore = window.isNativeApp;
    window.isNativeApp = () => true;
    const native = Subscribe();
    window.isNativeApp = nativeBefore;
    S.subStep = 2;
    const step2 = Subscribe();
    return { web: web.includes('deleteMyAccount()'), native: native.includes('deleteMyAccount()'), step2: step2.includes('deleteMyAccount()') };
  });
  expect(r).toEqual({ web: true, native: true, step2: true });
});
