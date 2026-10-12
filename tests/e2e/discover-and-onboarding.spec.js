const { test, expect } = require('@playwright/test');

// Two defects the owner hit on a real device, in one file because both are
// about a screen that cannot be left.
//
// 1. Reels ("דרילס") rendered a black "טוען דרילס..." screen forever.
//    loadDiscoverFeed() returned silently when currentUser or db was not ready
//    yet, without marking the attempt finished - and the screen renders that
//    black state on exactly `!discoverFeedLoaded`, with nothing retrying. The
//    window is real: right after sign-in currentUser exists while the RTDB
//    connection has not re-authenticated. The correct end state when there is
//    nothing to show is the empty state that already exists below it.
//
// 2. The onboarding a new user saw was written entirely for a student, so a
//    teenager who installed the app to TEACH was told how to find a teacher
//    and book a lesson.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof go === 'function' && typeof showOnboarding === 'function');
}

test.describe('Reels cannot get stuck on the loading screen', () => {
  test('a database that never answers still ends on the empty state', async ({ page }) => {
    await boot(page);
    const text = await page.evaluate(async () => {
      currentUser = { uid: 'u1', email: 'u@example.com', emailVerified: true };
      currentUserData = { name: 'משתמש', role: 'student', verified: true };
      discoverFeedLoaded = false; discoverFeedLoading = false;
      teachersLoaded = true;
      // A get() that never settles — the shape of a dead mobile connection.
      db = { ref: () => ({ get: () => new Promise(() => {}) }) };
      S.screen = 'discover';
      await loadDiscoverFeed(true);
      return { loaded: discoverFeedLoaded, loading: discoverFeedLoading, html: Discover() };
    });
    expect(text.loading, 'the loading flag must not stay set').toBe(false);
    expect(text.loaded, 'the attempt must be marked finished').toBe(true);
    expect(text.html).toContain('אין עדיין סרטונים להצגה');
    expect(text.html).not.toContain('טוען דרילס');
  });

  test('entering before the connection is ready shows the empty state, not a spinner', async ({ page }) => {
    await boot(page);
    const html = await page.evaluate(async () => {
      currentUser = { uid: 'u1', email: 'u@example.com', emailVerified: true };
      discoverFeedLoaded = false; discoverFeedLoading = false;
      db = null;                       // the post-login window
      S.screen = 'discover';
      await loadDiscoverFeed(true);
      return Discover();
    });
    expect(html).not.toContain('טוען דרילס');
    expect(html).toContain('אין עדיין סרטונים להצגה');
  });
});

test.describe('onboarding speaks to the role that signed up', () => {
  const open = (role) => async (page) => {
    await page.evaluate((r) => {
      ['teacher', 'student'].forEach((x) => localStorage.removeItem('_onboardingDone_' + x));
      currentUserData = { name: 'מישהו', role: r, verified: true };
      showOnboarding();
    }, role);
  };

  test('a teacher is told how to teach, never how to find a teacher', async ({ page }) => {
    await boot(page);
    await open('teacher')(page);
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).toContain('בנה פרופיל שבוחרים בו');
    expect(body).not.toContain('מצא מורה');
    expect(body).not.toContain('הזמן שיעור');
  });

  test('a student still gets the original three', async ({ page }) => {
    await boot(page);
    await open('student')(page);
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).toContain('מצא מורה');
    expect(body).not.toContain('בנה פרופיל שבוחרים בו');
  });

  test('finishing as a student does not suppress the teacher version', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      ['teacher', 'student'].forEach((x) => localStorage.removeItem('_onboardingDone_' + x));
      currentUserData = { role: 'student' };
      showOnboarding();
      // walk to the end
      for (let i = 0; i < 3; i++) document.querySelector('#_obNext')?.click();
      currentUserData = { role: 'teacher' };
      showOnboarding();
    });
    expect(await page.evaluate(() => document.body.innerText)).toContain('בנה פרופיל שבוחרים בו');
  });

  test('the admin reset clears both roles', async ({ page }) => {
    await boot(page);
    const left = await page.evaluate(() => {
      ['teacher', 'student'].forEach((x) => localStorage.setItem('_onboardingDone_' + x, '1'));
      _obReset();
      return ['teacher', 'student'].filter((x) => localStorage.getItem('_onboardingDone_' + x));
    });
    expect(left).toEqual([]);
  });

  test('the founding-member line tracks PLATFORM_HAS_STUDENTS, not a second copy', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      flag: PLATFORM_HAS_STUDENTS,
      last: _obSteps('teacher')[2].desc,
    }));
    // While the signup screen tells teachers there are no students yet, the
    // onboarding must not promise something that contradicts it.
    expect(r.last.includes('מייסדים')).toBe(!r.flag);
  });
});
