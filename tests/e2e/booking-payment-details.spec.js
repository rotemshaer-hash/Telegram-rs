const { test, expect } = require('@playwright/test');

// Found while verifying an external review (27.10.2026): the booking screen read
// t.payment, but the teacher list loader never copies payment into TEACHERS, so
// every student saw "the teacher has not set payment details — cannot complete
// the booking" even for a teacher who had. The details now come from
// teacherPrivate/<uid> (see loadTeacherPrivate), and these tests drive the REAL
// loadRealTeachers + Booking() against a stubbed database that serves each node.

const BIT = '050-1234567';

// A chainable stand-in for db.ref(path)...get(): `nodes` maps a path to the
// value it should hold, everything else is empty.
function installDb(nodes) {
  const empty = { exists: () => false, val: () => null, forEach: () => {} };
  const snapFor = (path) => {
    const v = nodes[path];
    if (v === undefined) return empty;
    if (path === 'teachers') return { exists: () => true, val: () => v, forEach: (cb) => Object.entries(v).forEach(([k, x]) => cb({ key: k, val: () => x })) };
    return { exists: () => true, val: () => v, forEach: () => {} };
  };
  const mk = (path) => new Proxy({}, {
    get: (_, k) => {
      if (k === 'get' || k === 'once') return async () => snapFor(path);
      if (k === 'on' || k === 'off') return () => {};
      if (k === 'then') return undefined;
      return () => mk(path);
    },
  });
  db = { ref: (p) => mk(p) };
}

async function bookingScreenText(page, { publicRecord, privateRecord }) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof loadRealTeachers === 'function');
  return page.evaluate(async ({ publicRecord, privateRecord, installSrc }) => {
    // eslint-disable-next-line no-new-func
    new Function('nodes', installSrc)({ teachers: { teach1: publicRecord }, 'teacherPrivate/teach1': privateRecord });
    await Promise.race([loadRealTeachers(), new Promise((r) => setTimeout(r, 3000))]);
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true };
    S.bookStep = 2; S.bookType = 'single';
    go('booking', { teacher: TEACHERS[0] });
    await new Promise((r) => setTimeout(r, 400));
    return {
      text: document.getElementById('app').innerText,
      publicHasPrivate: ['payment', 'meetingLink', 'email'].some((k) => k in TEACHERS[0]),
    };
  }, { publicRecord, privateRecord, installSrc: `(${installDb.toString()})(nodes)` });
}

const PUBLIC = { name: 'מורה', verified: true, cat: 'chess', cats: ['chess'], price: 60 };

test.describe('booking screen payment details', () => {
  test('a student sees how to pay, loaded from teacherPrivate', async ({ page }) => {
    const r = await bookingScreenText(page, {
      publicRecord: PUBLIC,
      privateRecord: { payment: { bit: BIT, paypal: '', paybox: '' }, email: 't@example.com' },
    });
    expect(r.text, 'the teacher’s Bit number should be shown').toContain(BIT);
    expect(r.text).not.toContain('טרם הגדיר');
    expect(r.publicHasPrivate, 'the public list must not carry private fields').toBe(false);
  });

  test('a teacher with no payment details still gets the honest warning', async ({ page }) => {
    const r = await bookingScreenText(page, { publicRecord: PUBLIC, privateRecord: { email: 't@example.com' } });
    expect(r.text).toContain('טרם הגדיר');
  });
});
