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
    expect(text.html).not.toContain('טוען דרילס');
    // A timeout is not an empty platform, and must not claim to be one.
    expect(text.html).toContain('לא הצלחנו לטעון את הדרילס');
    expect(text.html).toContain('נסה שוב');
    expect(text.html).not.toContain('אין עדיין סרטונים');
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
    expect(html).toContain('לא הצלחנו לטעון את הדרילס');
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

// The owner has three approved videos on one teacher, so the feed must still
// work end to end after the loading change — not only its empty state.
test.describe('Reels still plays a real feed', () => {
  const ROTEM = {
    id: 'rotem-uid', name: 'רותם', cat: 'math', city: 'תל אביב', price: 80,
    rating: 4.8, photo: null, col: '#14B8A6', av: '📐',
  };
  const VIDEOS = {
    'rotem-uid': {
      v1: { title: 'שבר ראשון', url: 'https://youtu.be/aaa', platform: 'youtube', approved: true, createdAt: 3, views: 5 },
      v2: { title: 'משוואות', url: 'https://youtu.be/bbb', platform: 'youtube', approved: true, createdAt: 2, views: 9 },
      v3: { title: 'גאומטריה', url: 'https://youtu.be/ccc', platform: 'youtube', approved: true, createdAt: 1, views: 1 },
      v4: { title: 'עוד לא אושר', url: 'https://youtu.be/ddd', platform: 'youtube', approved: false, createdAt: 0 },
    },
  };

  async function feed(page) {
    await boot(page);
    return page.evaluate(async (data) => {
      // A snapshot shaped like the RTDB one: forEach over teachers, then videos.
      const snap = (obj) => ({
        exists: () => true,
        forEach: (fn) => Object.entries(obj).forEach(([k, inner]) => fn({
          key: k,
          forEach: (f2) => Object.entries(inner).forEach(([k2, v]) => f2({ key: k2, val: () => v })),
        })),
      });
      currentUser = { uid: 'viewer', email: 'v@example.com', emailVerified: true };
      currentUserData = { name: 'צופה', role: 'student', verified: true };
      TEACHERS.length = 0; TEACHERS.push(data.ROTEM);
      teachersLoaded = true;
      discoverFeedLoaded = false; discoverFeedLoading = false;
      db = { ref: () => ({ get: () => Promise.resolve(snap(data.VIDEOS)) }) };
      S.screen = 'discover';
      await loadDiscoverFeed(true);
      return { count: DISCOVER_FEED.length, html: Discover() };
    }, { ROTEM, VIDEOS });
  }

  test('shows every approved video and none that is pending', async ({ page }) => {
    const r = await feed(page);
    expect(r.count, 'three approved, the fourth is pending').toBe(3);
    expect(r.html).toContain('שבר ראשון');
    expect(r.html).toContain('משוואות');
    expect(r.html).toContain('גאומטריה');
    expect(r.html).not.toContain('עוד לא אושר');
  });

  test('each slide carries the teacher and a way to book', async ({ page }) => {
    const r = await feed(page);
    expect(r.html).not.toContain('טוען דרילס');
    expect(r.html).not.toContain('אין עדיין סרטונים');
    expect(r.html).toContain('רותם');
    expect(r.html).toContain('הזמן שיעור · ₪80');
    expect((r.html.match(/class="discover-slide"/g) || []).length).toBe(3);
  });

  test('the feed renders into the real screen, scroller and all', async ({ page }) => {
    await feed(page);
    await page.evaluate(() => render());
    await expect(page.locator('#_discoverScroller')).toBeVisible();
    await expect(page.locator('.discover-slide')).toHaveCount(3);
    await expect(page.getByText('שבר ראשון')).toBeVisible();
  });
});

// The reset button existed but was white text at 70% opacity on the app's
// light background — a contrast ratio near 1:1. The owner could not find it.
// It now sits in the action list above it, the component already used for
// edit profile / payments / leaderboard / log out.
test.describe('the tutorial reset is reachable', () => {
  test('is a row in the profile action list, not invisible text', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      currentUser = { uid: 'me', email: 'me@example.com', emailVerified: true };
      currentUserData = { name: 'רותם', role: 'teacher', verified: true, achievements: [] };
      S.pTab = 'about';
      go('profile');
      render();
      const rows = [...document.querySelectorAll('.card-sm')]
        .filter((el) => el.textContent.includes('הצג מדריך מחדש'));
      if (!rows.length) return { found: false };
      const span = [...rows[0].querySelectorAll('span')].find((s) => s.textContent.includes('הצג מדריך'));
      return { found: true, colour: getComputedStyle(span).color, visible: rows[0].offsetHeight > 0 };
    });
    expect(r.found, 'the reset must be one of the action rows').toBe(true);
    expect(r.visible).toBe(true);
    // Never white-on-light again: the row uses the same ink as its siblings.
    expect(r.colour).toBe('rgb(26, 26, 46)');
  });

  test('clicking it clears both role keys', async ({ page }) => {
    await boot(page);
    const left = await page.evaluate(() => {
      ['teacher', 'student'].forEach((x) => localStorage.setItem('_onboardingDone_' + x, '1'));
      currentUser = { uid: 'me', email: 'me@example.com', emailVerified: true };
      currentUserData = { name: 'רותם', role: 'teacher', verified: true, achievements: [] };
      S.pTab = 'about';
      go('profile'); render();
      [...document.querySelectorAll('.card-sm')]
        .find((el) => el.textContent.includes('הצג מדריך מחדש')).click();
      return ['teacher', 'student'].filter((x) => localStorage.getItem('_onboardingDone_' + x));
    });
    expect(left).toEqual([]);
  });
});

// A network blip must not lock the screen on a message that is simply untrue.
test.describe('a failed load is told apart from an empty platform', () => {
  test('a genuinely empty feed still says there are no videos yet', async ({ page }) => {
    await boot(page);
    const html = await page.evaluate(async () => {
      currentUser = { uid: 'u1', email: 'u@example.com', emailVerified: true };
      teachersLoaded = true;
      discoverFeedLoaded = false; discoverFeedLoading = false; discoverFeedFailed = false;
      db = { ref: () => ({ get: () => Promise.resolve({ exists: () => false, forEach: () => {} }) }) };
      S.screen = 'discover';
      await loadDiscoverFeed(true);
      return Discover();
    });
    expect(html).toContain('אין עדיין סרטונים להצגה');
    expect(html).not.toContain('נסה שוב');
  });

  test('retrying after a failure recovers the feed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const V = { t1: { v1: { title: 'חזר אחרי ניסיון', url: 'https://x/y', platform: 'youtube', approved: true } } };
      const snap = (o) => ({ exists: () => true, forEach: (fn) => Object.entries(o).forEach(([k, inner]) => fn({ key: k, forEach: (f2) => Object.entries(inner).forEach(([k2, v]) => f2({ key: k2, val: () => v })) })) });
      currentUser = { uid: 'u1', email: 'u@example.com', emailVerified: true };
      TEACHERS.length = 0; TEACHERS.push({ id: 't1', name: 'מורה', cat: 'math', price: 50, photo: null, col: '#14B8A6', av: '📐' });
      teachersLoaded = true;
      discoverFeedLoaded = false; discoverFeedLoading = false; discoverFeedFailed = false;
      let firstCall = true;
      db = { ref: () => ({ get: () => { if (firstCall) { firstCall = false; return Promise.reject(new Error('network')); } return Promise.resolve(snap(V)); } }) };
      S.screen = 'discover';
      await loadDiscoverFeed(true);
      const afterFail = Discover();
      // exactly what the retry button does
      await loadDiscoverFeed(true);
      return { afterFail, afterRetry: Discover(), failed: discoverFeedFailed };
    });
    expect(r.afterFail).toContain('לא הצלחנו לטעון את הדרילס');
    expect(r.failed).toBe(false);
    expect(r.afterRetry).toContain('חזר אחרי ניסיון');
    expect(r.afterRetry).not.toContain('לא הצלחנו');
  });
});
