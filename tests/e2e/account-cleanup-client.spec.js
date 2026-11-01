const { test, expect } = require('@playwright/test');

// The client can delete what a user wrote; the parent's address, the consent log,
// consent and portal tokens and stories are written by the server, so the server
// removes them (netlify/functions/account-cleanup.js). If that call fails, the
// deletion must say so — a reported success that leaves a minor's parent's address
// behind is the bug this whole path exists to prevent.

const run = async (page, ok, asUid) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof deleteAllUserData === 'function');
  return page.evaluate(async ({ ok, asUid }) => {
    const calls = [];
    window.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse((init && init.body) || '{}') }); return { ok }; };
    const empty = { exists: () => false, val: () => null, forEach: () => {} };
    db = { ref: () => ({ get: async () => empty, remove: async () => {} }) };
    currentUser = { uid: 'me', getIdToken: async () => 'tok' };
    const res = await deleteAllUserData(asUid || 'me', 'student');
    return { res, calls };
  }, { ok, asUid });
};

test('self-deletion asks the server to clean up, with the session only', async ({ page }) => {
  const r = await run(page, true);
  const call = r.calls.find((c) => c.url.includes('/api/account-cleanup'));
  expect(call).toBeTruthy();
  expect(call.body).toEqual({ idToken: 'tok' });
  expect(r.res.failedPaths).not.toContain('server-cleanup');
});

test('an admin deleting another account names it', async ({ page }) => {
  const r = await run(page, true, 'someone-else');
  const call = r.calls.find((c) => c.url.includes('/api/account-cleanup'));
  expect(call.body).toEqual({ idToken: 'tok', uid: 'someone-else' });
});

test('when the server cleanup fails the deletion reports it, so the login is not deleted', async ({ page }) => {
  const r = await run(page, false);
  expect(r.res.failedPaths).toContain('server-cleanup');
});
