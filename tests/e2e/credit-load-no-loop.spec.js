const { test, expect } = require('@playwright/test');

// QA review 29.10.2026: the profile's referral card asks for the credit balance
// and re-renders when the load finishes. _loadUserCredit swallowed a failure
// WITHOUT marking itself loaded, so every failed load (offline, weak signal)
// triggered a render that asked again — thousands of renders a second, the page
// locked. A failed load must be tried once.

test('a failing credit load is attempted once, not once per render', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Profile === 'function' && typeof go === 'function');
  const r = await page.evaluate(async () => {
    let gets = 0;
    const mk = (path) => new Proxy({}, {
      get: (_, k) => {
        if (k === 'get' || k === 'once') return async () => { if (path.startsWith('userCredits/')) { gets++; throw new Error('Client is offline'); } return { exists: () => false, val: () => null, forEach: () => {} }; };
        if (k === 'on' || k === 'off') return () => {};
        if (k === 'then') return undefined;
        return () => mk(path);
      },
    });
    db = { ref: (p) => mk(p || '') };
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true, refCode: 'abc12' };
    _userCredit = 0; _userCreditLoaded = false;
    S.pTab = 'about';
    go('profile');
    await new Promise((res) => setTimeout(res, 800));
    return { gets, loaded: _userCreditLoaded };
  });
  expect(r.gets).toBeLessThanOrEqual(2);
  expect(r.loaded).toBe(true);
});
