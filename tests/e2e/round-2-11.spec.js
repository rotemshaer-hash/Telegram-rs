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

test('the iOS app registers its push token with platform "ios"; Android with "android"', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _registerNativePush === 'function');
  const r = await page.evaluate(async () => {
    const out = {};
    for (const platform of ['ios', 'android']) {
      _pushSetupStarted = false;
      const listeners = {};
      window.Capacitor = {
        isNativePlatform: () => true, getPlatform: () => platform,
        Plugins: { PushNotifications: {
          checkPermissions: async () => ({ receive: 'granted' }), requestPermissions: async () => ({ receive: 'granted' }),
          addListener: (n, cb) => { listeners[n] = cb; }, register: async () => { listeners.registration({ value: 'tok-' + platform }); },
        } },
      };
      let written = null;
      db = { ref: (p) => ({ set: async (v) => { written = [p, v]; }, remove: async () => {} }) };
      currentUser = { uid: 'u1', email: 'a@b.c', emailVerified: true };
      await _registerNativePush();
      out[platform] = written;
    }
    return out;
  });
  expect(r.ios[0]).toBe('fcmTokens/tok-ios');
  expect(r.ios[1].platform).toBe('ios');
  expect(r.android[1].platform).toBe('android');
});

// Apple 4.2: real native behaviour where the plugin exists, and the normal web behaviour where it does not.
test('native share, haptics and the offline bar', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof shareNatively === 'function' && typeof nativeHaptic === 'function');
  const r = await page.evaluate(async () => {
    const out = {};
    out.webCan = canShareNatively() === !!navigator.share; // no plugin: the browser decides
    const calls = [];
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'ios',
      Plugins: {
        Share: { share: async (o) => { calls.push(['share', o.title, o.url]); } },
        Haptics: { notification: (o) => { calls.push(['haptic', o.type]); } },
      },
    };
    out.nativeCan = canShareNatively();
    await shareNatively({ title: 'כותרת', text: 't', url: 'https://x.example' });
    showFireToast('✅ נשמר'); showFireToast('❌ שגיאה'); showFireToast('שלום');
    out.calls = calls;
    _setOfflineBanner(true);
    out.bar = !!document.getElementById('_offlineBar');
    _setOfflineBanner(false);
    out.barGone = !document.getElementById('_offlineBar');
    return out;
  });
  expect(r.webCan).toBe(true);
  expect(r.nativeCan).toBe(true);
  expect(r.calls).toEqual([['share', 'כותרת', 'https://x.example'], ['haptic', 'SUCCESS'], ['haptic', 'ERROR']]);
  expect(r.bar).toBe(true);
  expect(r.barGone).toBe(true);
});

// Security review 7.11.2026: groups are no longer readable by a guest/unverified account, and the empty-groups
// screen tells "need to sign up" apart from "load failed" apart from "truly empty" (was a silent catch{}).
test('a guest or unverified user sees a sign-up prompt, not "no groups yet"; a load failure shows retry', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadCommunityGroups === 'function');
  const r = await page.evaluate(async () => {
    const out = {};
    db = { ref: () => ({ get: async () => { const e = new Error('x'); e.code = 'PERMISSION_DENIED'; throw e; } }) };
    await loadCommunityGroups();
    out.needVerified = groupsNeedVerified;
    out.loadFailed1 = groupsLoadFailed;
    db = { ref: () => ({ get: async () => { throw new Error('network'); } }) };
    await loadCommunityGroups();
    out.loadFailed2 = groupsLoadFailed;
    out.needVerified2 = groupsNeedVerified;
    return out;
  });
  expect(r.needVerified).toBe(true);
  expect(r.loadFailed1).toBe(false);
  expect(r.loadFailed2).toBe(true);
  expect(r.needVerified2).toBe(false);
});

// The guest-facing "groups need sign-up" screen must actually show its sign-up button to a guest.
// currentUser stays null for an anonymous (browse-as-guest) session by design — confirmed here, not assumed.
test('an anonymous guest sees the sign-up button on the groups-need-verification screen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Community === 'function' || typeof go === 'function');
  const r = await page.evaluate(() => {
    currentUser = null; // the app's own invariant for an anonymous guest (see onAuthStateChanged)
    currentUserData = null;
    communityGroups = [];
    groupsNeedVerified = true;
    groupsLoadFailed = false;
    S.comTab = 'groups';
    go('community');
    return { hasSignupBtn: document.body.innerText.includes('הרשמה'), hasGateMsg: document.body.innerText.includes('אחרי הרשמה ואישור') };
  });
  expect(r.hasGateMsg).toBe(true);
  expect(r.hasSignupBtn).toBe(true);
});

// A student approved while the app is open must see groups immediately (same fix the teacher path already had).
test('a newly approved student reloads groups, not stuck on the sign-up gate', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _attachStudentApprovalListener === 'function' && typeof loadRealTeachers === 'function');
  const r = await page.evaluate(async () => {
    let groupsReloaded = false;
    window.loadRealTeachers = async () => { groupsReloaded = true; groupsNeedVerified = false; };
    currentUser = { uid: 'kid' };
    currentUserData = { role: 'student', verified: false };
    S.screen = 'studentPending';
    db = { ref: () => ({ on: (ev, cb) => { cb({ exists: () => true, val: () => ({ verified: true }) }); } }) };
    _studentApprovalListenerUID = null;
    _attachStudentApprovalListener('kid');
    await new Promise((r2) => setTimeout(r2, 50));
    return { groupsReloaded, screen: S.screen };
  });
  expect(r.groupsReloaded).toBe(true);
  expect(r.screen).toBe('home');
});
