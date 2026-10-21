const { test, expect } = require('@playwright/test');

// Two features from the product-strategist review (drushe-product-strategist),
// both aimed at the same real gap: a teacher gets approved, has zero students,
// and the app did nothing about it beyond a one-line text notification.
//
// 1. A home-screen card, shown only while a teacher has never received a
//    single booking, that puts the already-built referral-share tool where
//    the teacher actually is instead of leaving it buried in a profile tab.
// 2. The 30-day free-trial clock used to start at registration. A teacher
//    with zero students could be told to pay before ever getting a real
//    shot — exactly the "no one to teach yet" problem the app is supposed
//    to be solving for them. It now starts at the first booking received,
//    with a 90-day cap for an account that never gets one at all.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof teacherTrialDaysLeft === 'function' && typeof shareMyReferralLink === 'function');
}

test.describe('trial clock starts at the first booking, not at registration', () => {
  async function setup(page, { createdAt, bookings, foundingMember = false }) {
    return page.evaluate(({ createdAt, bookings, foundingMember }) => {
      currentUserData = { role: 'teacher', createdAt, foundingMember };
      teacherAllBookings = bookings;
      teacherBookingsLoaded = true;
      return {
        expired: isTeacherTrialExpired(),
        daysLeft: teacherTrialDaysLeft(),
        needsSub: teacherNeedsSubscription(),
      };
    }, { createdAt, bookings, foundingMember });
  }

  test('zero bookings, registered 40 days ago: trial has not expired (old code would say it had)', async ({ page }) => {
    await boot(page);
    const DAY = 86400000;
    const r = await setup(page, { createdAt: Date.now() - 40 * DAY, bookings: [] });
    expect(r.expired, 'a teacher with no students yet must not be charged for having none').toBe(false);
    expect(r.needsSub).toBe(false);
  });

  test('zero bookings, registered 120 days ago: the 90-day grace cap kicks in', async ({ page }) => {
    await boot(page);
    const DAY = 86400000;
    const r = await setup(page, { createdAt: Date.now() - 120 * DAY, bookings: [] });
    expect(r.expired, 'an account with no bookings ever must not stay free forever').toBe(true);
  });

  test('a booking received 50 days ago, teacher registered 80 days ago: trial is expired (30 days from the booking)', async ({ page }) => {
    await boot(page);
    const DAY = 86400000;
    const r = await setup(page, {
      createdAt: Date.now() - 80 * DAY,
      bookings: [{ createdAt: Date.now() - 50 * DAY, status: 'completed' }],
    });
    expect(r.expired).toBe(true);
  });

  test('a booking received 10 days ago, teacher registered 80 days ago: trial still active (old code would say expired)', async ({ page }) => {
    await boot(page);
    const DAY = 86400000;
    const r = await setup(page, {
      createdAt: Date.now() - 80 * DAY,
      bookings: [{ createdAt: Date.now() - 10 * DAY, status: 'pending' }],
    });
    expect(r.expired, 'the clock must restart from the real first booking, not the old registration date').toBe(false);
    expect(r.daysLeft).toBeGreaterThan(15);
    expect(r.daysLeft).toBeLessThanOrEqual(20);
  });

  test('the earliest of several bookings is what counts, any status', async ({ page }) => {
    await boot(page);
    const DAY = 86400000;
    const r = await setup(page, {
      createdAt: Date.now() - 80 * DAY,
      bookings: [
        { createdAt: Date.now() - 5 * DAY, status: 'pending' },
        { createdAt: Date.now() - 35 * DAY, status: 'rejected' },
        { createdAt: Date.now() - 20 * DAY, status: 'completed' },
      ],
    });
    expect(r.expired, 'a rejected or cancelled booking still proves real demand existed').toBe(true);
  });

  test('a founding teacher never needs a subscription, bookings or not', async ({ page }) => {
    await boot(page);
    const DAY = 86400000;
    const r = await setup(page, { createdAt: Date.now() - 400 * DAY, bookings: [], foundingMember: true });
    expect(r.needsSub).toBe(false);
  });
});

test.describe('home screen: the zero-bookings referral card', () => {
  test('shown once bookings are loaded and empty, pointing at the same share tool as the wallet tab', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => {
      currentUser = { uid: 'u1', email: 'u1@example.com' };
      currentUserData = { role: 'teacher', name: 'מורה', refCode: 'abc123' };
      teacherAllBookings = [];
      teacherPendingBookings = [];
      teacherBookingsLoaded = true;
      let shared = false;
      window.shareMyReferralLink = () => { shared = true; };
      go('home');
      const card = document.body.innerText.includes('עדיין אין לך הזמנות');
      document.querySelector('[onclick*="shareMyReferralLink"]')?.click();
      return { card, shared };
    });
    expect(result.card).toBe(true);
    expect(result.shared, 'the card button must call the same shareMyReferralLink used in the wallet tab').toBe(true);
  });

  test('hidden once the teacher has a booking, even a pending one', async ({ page }) => {
    await boot(page);
    const hasCard = await page.evaluate(() => {
      currentUser = { uid: 'u1', email: 'u1@example.com' };
      currentUserData = { role: 'teacher', name: 'מורה', refCode: 'abc123' };
      teacherAllBookings = [{ id: 'b1', status: 'pending', createdAt: Date.now(), studentName: 'דני', day: 'א', time: '16:00', price: 80, payMethod: 'ביט' }];
      teacherPendingBookings = teacherAllBookings;
      teacherBookingsLoaded = true;
      go('home');
      return document.body.innerText.includes('עדיין אין לך הזמנות');
    });
    expect(hasCard).toBe(false);
  });

  test('hidden before bookings finish loading, so it never flashes for a teacher who already has students', async ({ page }) => {
    await boot(page);
    const hasCard = await page.evaluate(() => {
      currentUser = { uid: 'u1', email: 'u1@example.com' };
      currentUserData = { role: 'teacher', name: 'מורה', refCode: 'abc123' };
      teacherAllBookings = [];
      teacherBookingsLoaded = false; // load still in flight
      go('home');
      return document.body.innerText.includes('עדיין אין לך הזמנות');
    });
    expect(hasCard).toBe(false);
  });
});
