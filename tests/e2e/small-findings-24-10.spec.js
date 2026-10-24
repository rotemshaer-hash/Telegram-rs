const { test, expect } = require('@playwright/test');

// Two small findings from the drushe-qa-lead pass of 24.10.2026, fixed together
// because both are one-line changes to buttons/labels added on 21-23.10.
//
// 1. Three buttons added this week measured 41-43px tall against the 44px
//    touch-target floor the ux-accessibility agent checks for: the onboarding
//    "דלג", the Reels "נסה שוב" retry, and the zero-bookings "שלח לתלמידים
//    שלי". A pixel or two under target isn't a broken tap, but it's exactly
//    the kind of thing that drifts further the next time someone edits one
//    of these buttons without re-measuring.
//
// 2. Three UI strings still spelled the age range as a literal "8-18" /
//    "14-18" instead of reading AGE_RANGE, the constant added specifically so
//    this number has one definition. Today the numbers happen to agree; the
//    risk is a future change to AGE_RANGE that these three don't follow. The
//    test proves that by changing AGE_RANGE and checking the screens move
//    with it — matching numbers alone wouldn't catch a hardcoded string that
//    coincidentally still says the right thing.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof AGE_RANGE === 'object' && typeof showOnboarding === 'function');
}

const MIN_TOUCH_TARGET = 44;

test.describe('touch targets added 21-23.10 meet the 44px floor', () => {
  test('onboarding "דלג" button', async ({ page }) => {
    await boot(page);
    const height = await page.evaluate(() => {
      currentUser = { uid: 'u1', email: 'u@example.com' };
      currentUserData = { role: 'student', name: 'תלמיד' };
      ['teacher', 'student'].forEach((r) => { try { localStorage.removeItem('_onboardingDone_' + r); } catch (e) {} });
      showOnboarding();
      return document.getElementById('_obSkip')?.offsetHeight;
    });
    expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  test('Reels "נסה שוב" retry button, after a failed load', async ({ page }) => {
    await boot(page);
    const height = await page.evaluate(async () => {
      currentUser = { uid: 'u1', email: 'u@example.com' };
      currentUserData = { role: 'student', name: 'תלמיד', verified: true };
      teachersLoaded = true;
      discoverFeedLoaded = false; discoverFeedLoading = false; discoverFeedFailed = false;
      db = { ref: () => ({ get: () => Promise.reject(new Error('network')) }) };
      S.screen = 'discover';
      await loadDiscoverFeed(true);
      render();
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('נסה שוב'));
      return btn?.offsetHeight;
    });
    expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  test('home-screen "שלח לתלמידים שלי" button, shown at zero bookings', async ({ page }) => {
    await boot(page);
    const height = await page.evaluate(() => {
      currentUser = { uid: 'u1', email: 'u1@example.com' };
      currentUserData = { role: 'teacher', name: 'מורה', refCode: 'abc123' };
      teacherAllBookings = [];
      teacherPendingBookings = [];
      teacherBookingsLoaded = true;
      go('home');
      const btn = document.querySelector('[onclick*="shareMyReferralLink"]');
      return btn?.offsetHeight;
    });
    expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

test.describe('three age-range strings read AGE_RANGE instead of a hardcoded number', () => {
  test('the splash screen footer', async ({ page }) => {
    await boot(page);
    const text = await page.evaluate(() => {
      const original = { min: AGE_RANGE.student.min, max: AGE_RANGE.student.max };
      AGE_RANGE.student.min = 9; AGE_RANGE.student.max = 19;
      try {
        S.screen = 'splash';
        render();
        return document.getElementById('app').innerText;
      } finally {
        AGE_RANGE.student.min = original.min; AGE_RANGE.student.max = original.max;
      }
    });
    expect(text, 'a hardcoded "8–18" would not have moved to 9–19').toContain('9–19');
    expect(text).not.toContain('8–18');
  });

  test('the student registration safety notice', async ({ page }) => {
    await boot(page);
    const text = await page.evaluate(() => {
      const original = { min: AGE_RANGE.student.min, max: AGE_RANGE.student.max };
      AGE_RANGE.student.min = 9; AGE_RANGE.student.max = 19;
      try {
        S.parentRegData = { parentName: 'הורה', parentEmail: 'p@example.com' };
        go('register');
        render();
        return document.getElementById('app').innerText;
      } finally {
        AGE_RANGE.student.min = original.min; AGE_RANGE.student.max = original.max;
      }
    });
    expect(text, 'a hardcoded "8-18" would not have moved to 9-19').toContain('9-19');
    expect(text).not.toContain('8-18');
  });

  test('the teacher-registration age field label', async ({ page }) => {
    await boot(page);
    const text = await page.evaluate(() => {
      const original = { min: AGE_RANGE.teacher.min, max: AGE_RANGE.teacher.max };
      AGE_RANGE.teacher.min = 15; AGE_RANGE.teacher.max = 19;
      try {
        currentUser = { uid: 'u1', email: 'u1@example.com' };
        go('teacherSetup');
        render();
        return document.getElementById('app').innerText;
      } finally {
        AGE_RANGE.teacher.min = original.min; AGE_RANGE.teacher.max = original.max;
      }
    });
    expect(text, 'a hardcoded "14–18" would not have moved to 15–19').toContain('15–19');
    expect(text).not.toContain('14–18');
  });
});
