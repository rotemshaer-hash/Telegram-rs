const { test, expect } = require('@playwright/test');

// QA review 28.10.2026: the teacher's screens put the fields a STUDENT writes into
// teacherBookings (day, time, price, the id inside inline handlers, the platform
// label) straight into innerHTML, so a student could run script in a teacher's
// page — a minor's, with their chats open. Every one of those sinks now escapes.
// The rules refuse markup at write time too (tests/rules); this is the render side.

const HOSTILE_ID = "x');window.__xss=9;('";

test.describe('teacher screens: hostile booking fields stay text', () => {
  test('home, lessons list and bookings screens do not run script from a student-written booking', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof Home === 'function' && typeof go === 'function');
    const r = await page.evaluate(async ({ HOSTILE_ID }) => {
      const HOSTILE = (n) => `<img src=x onerror="window.__xss=${n}">`;
      window.__xss = 0;
      currentUser = { uid: 'teach1', email: 't@example.com', emailVerified: true };
      currentUserData = { name: 'מורה', role: 'teacher', verified: true };
      const hostile = (id, status) => ({
        id, studentId: 's1', teacherId: 'teach1', studentName: HOSTILE(2), teacherName: 'מורה',
        day: HOSTILE(1), time: HOSTILE(3), price: HOSTILE(4), status, createdAt: 1,
        meetingPlatform: HOSTILE(5), jitsiUrl: 'https://zoom.us/j/1', subject: HOSTILE(6), cat: HOSTILE(7),
      });
      teacherPendingBookings = [hostile(HOSTILE_ID, 'pending')];
      teacherAllBookings = [hostile(HOSTILE_ID, 'pending'), hostile('y', 'approved')];
      teacherBookingsLoaded = true;
      const seen = {};
      for (const screen of ['home', 'messages', 'lessons', 'bookings']) {
        try { go(screen); } catch (_e) { /* screen may not exist in this build */ }
        await new Promise((r) => setTimeout(r, 400));
        seen[screen] = window.__xss;
      }
      return { seen, html: document.getElementById('app').innerHTML };
    }, { HOSTILE_ID });
    expect(r.seen, 'no screen may have run script from a booking field').toEqual({ home: 0, messages: 0, lessons: 0, bookings: 0 });
    expect(r.html).not.toContain('<img src=x onerror');
  });

  // QA security review 29.10.2026: the inline handlers built their arguments with
  // JSON.stringify(x).replace(/"/g,'&quot;'), which left & alone, so a value that
  // CONTAINS the text &quot; was decoded by the browser into a real quote and broke
  // out of the JS string; and several handlers put the booking key, studentId or
  // another field between single quotes unescaped. Clicking is what runs those, so
  // this test clicks every button on each teacher screen.
  test('no handler runs script from a student-written booking, even after a click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof Messages === 'function' && typeof go === 'function');
    const r = await page.evaluate(async () => {
      window.__xss = 0;
      const ENT = '&quot;+(window.__xss=11)+&quot;';
      const KEY = "x');window.__xss=13;('";
      currentUser = { uid: 'teach1', email: 't@example.com', emailVerified: true };
      currentUserData = { name: 'מורה', role: 'teacher', verified: true };
      TEACHERS.length = 0;
      TEACHERS.push({ id: 'teach1', name: 'מורה', cat: 'chess', cats: ['chess'], price: 60 });
      const hostile = (id, status) => ({
        id, bookingId: id, studentId: KEY, teacherId: 'teach1', studentName: '");window.__xss=21;("', teacherName: 'מורה',
        day: ENT, time: ENT, price: 60, status, createdAt: Date.now(), dayIndex: 1,
        jitsiUrl: ENT, jitsiRoom: ENT, meetingPlatform: ENT, from: '<img src=x onerror="window.__xss=16">',
      });
      const list = [hostile(KEY, 'pending'), hostile(KEY + '1', 'approved'), hostile(KEY + '2', 'completed'), hostile(KEY + '3', 'rejected')];
      teacherPendingBookings = list.filter((b) => b.status === 'pending');
      teacherAllBookings = list;
      studentBookings = list;
      teacherBookingsLoaded = true;
      for (const step of [
        () => { S.pTab = 'bookings'; go('profile'); },
        () => go('messages'),
        () => go('weeklySchedule'),
      ]) {
        try { step(); } catch (_e) { /* screen may not exist in this build */ }
        await new Promise((res) => setTimeout(res, 400));
        // two passes: the first opens dialogs (WhatsApp message built from the booking),
        // the second clicks the buttons those dialogs just rendered
        for (let pass = 0; pass < 2; pass++) {
          for (const el of Array.from(document.querySelectorAll('[onclick]'))) {
            try { el.click(); } catch (_e) { /* handler may throw on fake data */ }
          }
          await new Promise((res) => setTimeout(res, 200));
        }
      }
      try { showPaymentManagement(); } catch (_e) { /* optional */ }
      await new Promise((res) => setTimeout(res, 300));
      return window.__xss;
    });
    expect(r, 'no handler or screen may have run script').toBe(0);
  });
});
