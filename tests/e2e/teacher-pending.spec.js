const { test, expect } = require('@playwright/test');

// QA 29.10.2026: the teacher's messages screen listed a pending request under the
// TEACHER's own name with the student's wording ("the teacher will approve within
// 24 hours") and no way to act; the home showed three requests under a heading that
// counted all of them, with no way to the rest, and the heading was ungrammatical
// ("4 בקשת שיעור חדשה").

const setup = async (page, n) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Home === 'function' && typeof go === 'function');
  return page.evaluate(async (n) => {
    currentUser = { uid: 'teach1', email: 't@example.com', emailVerified: true };
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    TEACHERS.length = 0;
    TEACHERS.push({ id: 'teach1', name: 'מורה', cat: 'chess', cats: ['chess'], price: 60 });
    const list = Array.from({ length: n }, (_, i) => ({
      id: 'p' + i, studentId: 's' + i, teacherId: 'teach1', studentName: 'ילד' + i, teacherName: 'מורה',
      day: "ב' 3 נוב", time: '1' + i + ':00', price: 60, status: 'pending', createdAt: 1000 - i,
    }));
    teacherPendingBookings = list; teacherAllBookings = list; studentBookings = list; teacherBookingsLoaded = true;
    const read = async (screen) => { go(screen); await new Promise((r) => setTimeout(r, 400)); return document.getElementById('app').innerText; };
    return { home: await read('home'), messages: await read('messages') };
  }, n);
};

test('four requests: the heading is grammatical and the rest is one tap away', async ({ page }) => {
  const r = await setup(page, 4);
  expect(r.home).toContain('4 בקשות שיעור חדשות!');
  expect(r.home).not.toContain('בקשת שיעור חדשה!');
  expect(r.home).toContain('עוד בקשה אחת');
});

test('one request: singular heading, no "more" link', async ({ page }) => {
  const r = await setup(page, 1);
  expect(r.home).toContain('בקשת שיעור חדשה!');
  expect(r.home).not.toContain('עוד ');
});

test('the teacher’s messages screen names the student and offers approve and reject', async ({ page }) => {
  const r = await setup(page, 2);
  expect(r.messages).toContain('ילד0');
  expect(r.messages).toContain('אשר');
  expect(r.messages).toContain('דחה');
  expect(r.messages).not.toContain('המורה יאשר תוך 24 שעות');
});
