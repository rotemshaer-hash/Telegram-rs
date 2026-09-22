const { test, expect } = require('@playwright/test');

// A student's review used to end in "❌ שגיאה בשמירת הביקורת" even though it
// was saved. After saving, the student's own device recomputed the teacher's
// rating and wrote it to teachers/<teacherId>/rating, and database.rules.json
// only lets the teacher or the admin write that node, so the write was refused
// and the catch reported the whole review as failed. A retry then got "כבר
// דירגת מורה זה". On the booking path the refusal also came before the email
// to the parent, so that email never went out.
//
// The stub below refuses every write under teachers/, the way the real rules
// do for a student, and records everything else.

const TEACHER_ID = 'teacher-x';
const STUDENT_ID = 'student-x';

async function setup(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof submitDirectReview === 'function');
  await page.evaluate(({ TEACHER_ID, STUDENT_ID }) => {
    window.__writes = [];
    window.__denied = [];
    window.__toasts = [];
    const stored = {};
    const snap = (path) => ({
      exists: () => stored[path] !== undefined,
      val: () => stored[path] ?? null,
      forEach: () => {},
      key: path.split('/').pop(),
    });
    const ref = (path) => {
      const r = {
        key: path.split('/').pop(),
        set: (v) => {
          if (path.startsWith('teachers/')) {
            window.__denied.push(path);
            return Promise.reject(new Error('PERMISSION_DENIED: Permission denied'));
          }
          stored[path] = v; window.__writes.push(path); return Promise.resolve();
        },
        update: (v) => { window.__writes.push(path); return Promise.resolve(); },
        get: () => Promise.resolve(snap(path)),
        once: () => Promise.resolve(snap(path)),
        orderByChild: () => r, equalTo: () => r, limitToLast: () => r,
        child: (p) => ref(path + '/' + p),
      };
      return r;
    };
    db = { ref };
    currentUser = { uid: STUDENT_ID, email: 'kid@example.com', emailVerified: true };
    currentUserData = { name: 'ילד', role: 'student', verified: true, parentEmail: 'parent@example.com', parentName: 'הורה' };
    studentBookings = [{ id: 'b1', teacherId: TEACHER_ID, studentId: STUDENT_ID, status: 'completed' }];
    const origToast = window.showFireToast;
    window.showFireToast = (m) => { window.__toasts.push(String(m)); try { origToast(m); } catch (e) {} };
    S.ratingStars = 5;
    document.body.insertAdjacentHTML('beforeend', '<textarea id="_reviewTextarea">שיעור מעולה</textarea>');
  }, { TEACHER_ID, STUDENT_ID });
}

test('a direct review reports success and shows the thank-you screen', async ({ page }) => {
  await setup(page);
  await page.evaluate((id) => submitDirectReview(id), TEACHER_ID);
  const r = await page.evaluate(() => ({ done: S.ratingDone, toasts: window.__toasts, writes: window.__writes }));
  expect(r.writes).toContain('reviews/teacher-x/b1');
  expect(r.toasts.some((t) => t.includes('❌')), 'no error toast: ' + r.toasts.join(' | ')).toBe(false);
  expect(r.done).toBe(true);
});

test('a review from a booking completes without an error', async ({ page }) => {
  await setup(page);
  const outcome = await page.evaluate(async (id) => {
    try { await submitReview('b1', {}, id, 5, 'מעולה', true); return 'ok'; } catch (e) { return 'threw: ' + e.message; }
  }, TEACHER_ID);
  const toasts = await page.evaluate(() => window.__toasts);
  expect(outcome).toBe('ok');
  expect(toasts.some((t) => t.includes('❌')), 'no error toast: ' + toasts.join(' | ')).toBe(false);
});
