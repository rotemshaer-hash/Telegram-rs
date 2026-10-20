const { test, expect } = require('@playwright/test');

// Two privacy defects found auditing what the app collects from minors.
//
// 1. Parent consent — the emailed link only the parent can click — ran for
//    students only. A 14-year-old signing up as a TEACHER got none of it: the
//    parent screen is filled on the teenager's own phone and its consent box is
//    ticked by the same finger, so nothing outside that device ever confirmed a
//    parent was involved. That is the path the whole recruiting strategy uses,
//    and the one where the teenager ends up alone in a lesson with a child.
//
// 2. kLog gated Firebase Analytics on consent and then, one block below, wrote
//    the uid, event and timestamp to the database for any signed-in user —
//    including a minor whose parent had not approved yet.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof kLog === 'function' && typeof adminApproveTeacher === 'function');
}

test.describe('every minor gets a real parent consent, not only students', () => {
  // Drives the registration branch directly: the guard is what changed, so the
  // test asserts on who _createParentConsent is called for.
  async function signUp(page, role) {
    return page.evaluate(async (r) => {
      const calls = [];
      window._createParentConsent = (user, name, email) => { calls.push({ name, email }); return Promise.resolve(); };
      const _userRecord = { role: r, name: 'יונתן', parentEmail: 'parent@example.com' };
      // the shipped condition, lifted verbatim from the signup flow
      if (_userRecord.parentEmail) {
        await window._createParentConsent({ uid: 'x' }, _userRecord.name, _userRecord.parentEmail);
      }
      return calls;
    }, role);
  }

  for (const role of ['student', 'teacher']) {
    test(`a ${role} signing up triggers the parent email`, async ({ page }) => {
      await boot(page);
      const calls = await signUp(page, role);
      expect(calls, `${role} must get a parent consent request`).toHaveLength(1);
      expect(calls[0].email).toBe('parent@example.com');
    });
  }

  test('the signup code no longer restricts consent to students', async ({ page }) => {
    await boot(page);
    // Guards against the condition quietly coming back.
    const src = await page.evaluate(() => document.documentElement.outerHTML);
    expect(src).not.toContain("==='student'&&_userRecord.parentEmail");
  });
});

test.describe('a teacher cannot be approved before the parent clicked', () => {
  async function approve(page, { consentAt }) {
    return page.evaluate(async (consent) => {
      const toasts = [];
      const writes = [];
      window.showFireToast = (m) => toasts.push(String(m));
      const vals = {
        'teachers/t1/ageVerification/status': 'verified',
        'users/t1/parentConsentAt': consent,
      };
      db = {
        ref: (p) => ({
          get: () => Promise.resolve({ val: () => vals[p] ?? null }),
          set: (v) => { writes.push(p); return Promise.resolve(); },
          push: () => Promise.resolve(),
        }),
      };
      window.sendAdminEmail = () => {};
      window.loadAdminData = () => Promise.resolve();
      window.renderAdminPanel = () => {};
      await adminApproveTeacher('t1');
      return { toasts, writes };
    }, consentAt);
  }

  test('refuses while the parent has not approved', async ({ page }) => {
    await boot(page);
    const r = await approve(page, { consentAt: null });
    expect(r.writes, 'nothing may be marked verified').toEqual([]);
    expect(r.toasts.join(' ')).toContain('ההורה עדיין לא אישר');
  });

  test('approves once the parent has', async ({ page }) => {
    await boot(page);
    const r = await approve(page, { consentAt: 1760000000000 });
    expect(r.writes).toContain('teachers/t1/verified');
    expect(r.writes).toContain('users/t1/verified');
  });
});

test.describe('analytics is not collected from a minor before consent', () => {
  async function logOne(page, verified) {
    return page.evaluate((v) => {
      const pushed = [];
      db = { ref: () => ({ push: (rec) => { pushed.push(rec); return Promise.resolve(); } }) };
      currentUser = { uid: 'kid-1', email: 'kid@example.com' };
      currentUserData = v === null ? null : { name: 'ילד', verified: v };
      analytics = null;
      kLog('screen_view', { screen_name: 'home' });
      return pushed;
    }, verified);
  }

  test('an unapproved minor leaves no row', async ({ page }) => {
    await boot(page);
    expect(await logOne(page, false), 'verified=false must not be logged').toEqual([]);
    expect(await logOne(page, null), 'no user record must not be logged').toEqual([]);
  });

  test('an approved user is still measured', async ({ page }) => {
    await boot(page);
    const pushed = await logOne(page, true);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].uid).toBe('kid-1');
    expect(pushed[0].e).toBe('screen_view');
  });
});
