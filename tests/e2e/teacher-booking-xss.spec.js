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
});
