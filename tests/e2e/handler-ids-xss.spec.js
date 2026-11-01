const { test, expect } = require('@playwright/test');

// A key in the database may contain ' ( ) ; so an id written by another user and
// put raw between quotes in an inline handler runs code for whoever clicks. This
// drives the groups card on the home screen (a group key can be chosen by any
// signed-in user under the rules) — the first screen outside the booking flow
// where it was proven (29.10.2026). scripts/check-handler-escapes.js covers the
// rest of the app statically; this one proves the escape holds in a real browser.

test('a hostile group id does not run script when the card is clicked', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Home === 'function' && typeof go === 'function');
  const r = await page.evaluate(async () => {
    window.__xss = 0;
    currentUser = { uid: 'teach1', email: 't@example.com', emailVerified: true };
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    TEACHERS.length = 0;
    TEACHERS.push({ id: 'teach1', name: 'מורה', cat: 'chess', cats: ['chess'], price: 60 });
    teacherPendingBookings = []; teacherAllBookings = []; teacherBookingsLoaded = true;
    communityGroups = [{
      id: "x');window.__xss=1;('", status: 'open', title: 'קבוצה', subject: 'chess',
      maxStudents: 5, membersCount: 1, teacherId: 'someone', day: 'א', time: '10:00', price: 10,
    }];
    go('home');
    await new Promise((res) => setTimeout(res, 500));
    let clicked = 0;
    for (const el of Array.from(document.querySelectorAll('[onclick]'))) {
      if ((el.getAttribute('onclick') || '').includes('showGroupDetail')) { clicked++; try { el.click(); } catch (_e) { /* fake data */ } }
    }
    await new Promise((res) => setTimeout(res, 300));
    return { clicked, xss: window.__xss };
  });
  expect(r.clicked, 'the group card must be on screen for this test to mean anything').toBeGreaterThan(0);
  expect(r.xss).toBe(0);
});
