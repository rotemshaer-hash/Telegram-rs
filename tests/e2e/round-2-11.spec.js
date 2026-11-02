const { test, expect } = require('@playwright/test');

// 2.11.2026 round: group approval, report content, blocked-users list, parent email on an interrupted signup.
test('a new group is written as pending and the admin is told', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _saveNewGroup === 'function' && typeof adminDecideGroup === 'function');
  const r = await page.evaluate(async () => {
    const writes = [];
    const mk = (p) => ({ set: async (v) => { writes.push([p, v]); }, push: (v) => { if (v) writes.push([p, v]); return { key: 'g1', set: async (x) => { writes.push([p, x]); } }; }, update: async () => {}, remove: async () => {}, get: async () => ({ exists: () => false, val: () => null, forEach: () => {} }) });
    db = { ref: (p) => mk(p) };
    currentUser = { uid: 'teach', email: 't@example.com', emailVerified: true };
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    document.body.insertAdjacentHTML('beforeend', '<input id="_cgTitle" value="שחמט"><input id="_cgLocation" value="הרצל 15, תל אביב"><input id="_cgDesc" value="כיף"><select id="_cgCat"><option value="x" selected>x</option></select>');
    await _saveNewGroup();
    const group = writes.find((w) => w[0] === 'groups' || (w[1] && w[1].teacherId === 'teach'));
    const notified = writes.some((w) => w[0] === 'adminNotifs' && w[1].type === 'newGroup');
    return { status: group && group[1].status, notified };
  });
  expect(r.status).toBe('pending');
  expect(r.notified).toBe(true);
});

test('a report carries the reported text; the blocked list shows names and can unblock', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof reportBtnHtml === 'function' && typeof showBlockedUsers === 'function');
  const r = await page.evaluate(async () => {
    currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true };
    const html = reportBtnHtml('post', 'teach', 'מורה', "טקסט');alert(1);('");
    const removed = [];
    db = { ref: (p) => ({ get: async () => ({ exists: () => true, val: () => ({ teach: true }) }), remove: async () => { removed.push(p); } }) };
    _rememberBlockedName('teach', 'המורה החסום');
    await showBlockedUsers();
    const shown = document.body.innerText.includes('המורה החסום');
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('בטל חסימה'));
    const h = btn.getBoundingClientRect().height;
    await unblockUserForMe('teach', btn);
    return { html, shown, removed, h };
  });
  expect(r.html).toContain('showReportDialog');
  expect(r.html).not.toContain("alert(1);('");
  expect(r.shown).toBe(true);
  expect(r.removed).toEqual(['userBlockedUsers/kid/teach']);
  expect(r.h).toBeGreaterThanOrEqual(44);
});

test('lesson price range is one definition; an unknown meeting host is refused', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof meetingLinkClean === 'function');
  const r = await page.evaluate(() => ({ min: LESSON_PRICE_MIN, max: LESSON_PRICE_MAX, bad: meetingLinkClean('https://evil.example/zoom.us'), ok: meetingLinkClean('https://meet.google.com/abc-defg-hij') }));
  expect(r.min).toBe(20);
  expect(r.max).toBe(60);
  expect(r.bad).toBe('');
  expect(r.ok).toBe('https://meet.google.com/abc-defg-hij');
});

// Apple 3.1.1: inside the iOS app there is no payment UI and no subscription lock (teachers are never gated there).
test('in the iOS app a teacher is never gated by the subscription and sees no payment banner', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof teacherNeedsSubscription === 'function' && typeof isIosApp === 'function');
  const r = await page.evaluate(() => {
    currentUserData = { role: 'teacher', createdAt: Date.now() - 400 * 86400000, name: 'מורה' };
    teacherAllBookings = [];
    const web = { ios: isIosApp(), needs: teacherNeedsSubscription(), banner: _teacherSubscriptionBanner().length > 0 };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const ios = { ios: isIosApp(), needs: teacherNeedsSubscription(), banner: _teacherSubscriptionBanner() };
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    const android = { ios: isIosApp(), needs: teacherNeedsSubscription() };
    return { web, ios, android };
  });
  expect(r.web).toEqual({ ios: false, needs: true, banner: true });
  expect(r.ios).toEqual({ ios: true, needs: false, banner: '' });
  expect(r.android).toEqual({ ios: false, needs: true });
});
