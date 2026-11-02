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
  expect(call.body).toEqual({ idToken: 'tok', chatPartners: [], groupIds: [], role: 'student' });
  expect(r.res.failedPaths).not.toContain('server-cleanup');
});

test('an admin deleting another account names it', async ({ page }) => {
  const r = await run(page, true, 'someone-else');
  const call = r.calls.find((c) => c.url.includes('/api/account-cleanup'));
  expect(call.body).toEqual({ idToken: 'tok', uid: 'someone-else', chatPartners: [], groupIds: [], role: 'student' });
});

test('when the server cleanup fails the deletion reports it, so the login is not deleted', async ({ page }) => {
  const r = await run(page, false);
  expect(r.res.failedPaths).toContain('server-cleanup');
});

test('the conversation partners and group ids go to the server, and the client no longer deletes messages', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof deleteAllUserData === 'function');
  const r = await page.evaluate(async () => {
    const calls = []; const removed = [];
    window.fetch = async (url, init) => { calls.push(JSON.parse((init && init.body) || '{}')); return { ok: true }; };
    const snap = (keys) => ({ exists: () => keys.length > 0, val: () => null, forEach: (cb) => keys.forEach((k) => cb({ key: k, val: () => ({}) })) });
    db = { ref: (p) => ({ get: async () => (p === 'userChats/me' ? snap(['u2', 'u3']) : p === 'userGroups/me' ? snap(['g1']) : snap([])), remove: async () => { removed.push(p); } }) };
    currentUser = { uid: 'me', getIdToken: async () => 'tok' };
    await deleteAllUserData('me', 'student');
    return { body: calls[0], removed };
  });
  expect(r.body.chatPartners).toEqual(['u2', 'u3']);
  expect(r.body.groupIds).toEqual(['g1']);
  expect(r.removed.some((p) => p.startsWith('messages/'))).toBe(false);
  // the lists go only after the server succeeded
  expect(r.removed).toContain('userChats/me');
  expect(r.removed).toContain('userGroups/me');
});

test('when the server cleanup fails the chat and group lists are kept, so a retry still knows what to delete', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof deleteAllUserData === 'function');
  const r = await page.evaluate(async () => {
    const removed = [];
    window.fetch = async () => ({ ok: false });
    const snap = (keys) => ({ exists: () => keys.length > 0, val: () => null, forEach: (cb) => keys.forEach((k) => cb({ key: k, val: () => ({}) })) });
    db = { ref: (p) => ({ get: async () => (p === 'userChats/me' ? snap(['u2']) : snap([])), remove: async () => { removed.push(p); } }) };
    currentUser = { uid: 'me', getIdToken: async () => 'tok' };
    const res = await deleteAllUserData('me', 'student');
    return { removed, failed: res.failedPaths };
  });
  expect(r.failed).toContain('server-cleanup');
  expect(r.removed).not.toContain('userChats/me');
  expect(r.removed).not.toContain('userGroups/me');
});
