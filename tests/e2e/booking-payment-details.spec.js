const { test, expect } = require('@playwright/test');

// Product rule (owner, 27.10.2026): Drushe is not involved in the money of a
// lesson — the student and the teacher settle it between themselves. Drushe's
// only revenue is the teacher subscription. So the booking flow must not
// collect, require, show or record lesson payment details.
//
// What it used to do: teacher registration and editing REQUIRED a Bit/PayPal/
// PayBox number, the booking screen showed it and blocked the booking when it
// was missing, and — because the list loader never copied it — every student
// saw "the teacher has not set payment details" even when they had. These tests
// drive the real loader, Booking() and requestBooking().

function installDb(nodes, writes) {
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
      if (k === 'push') return () => ({ key: 'bk1' });
      if (k === 'update') return async (v) => { writes.push(v); };
      if (k === 'on' || k === 'off') return () => {};
      if (k === 'then') return undefined;
      return () => mk(path);
    },
  });
  return { ref: (p) => mk(p || '') };
}

const PUBLIC = { name: 'מורה', verified: true, cat: 'chess', cats: ['chess'], price: 60 };


test.describe('booking: no lesson payment handling', () => {
  async function run(page, privateRecord) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof loadRealTeachers === 'function' && typeof requestBooking === 'function');
    return page.evaluate(async ({ privateRecord, publicRecord, installSrc }) => {
      window.__writes = [];
      // eslint-disable-next-line no-new-func
      db = new Function('nodes', 'writes', `return (${installSrc})(nodes, writes)`)(
        { teachers: { teach1: publicRecord }, 'teacherPrivate/teach1': privateRecord }, window.__writes);
      await Promise.race([loadRealTeachers(), new Promise((r) => setTimeout(r, 3000))]);
      currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
      currentUserData = { name: 'תלמיד', role: 'student', verified: true };
      sendEmail = async () => {}; notifyUser = () => {};
      S.bookStep = 2; S.bookType = 'single'; S.bookDayIdx = 1; S.bookTime = '10:00';
      go('booking', { teacher: TEACHERS[0] });
      await new Promise((r) => setTimeout(r, 300));
      const screen = document.getElementById('app').innerText;
      S.teacher = TEACHERS[0];
      await requestBooking(60);
      return { screen, written: window.__writes[0] || null };
    }, { privateRecord, publicRecord: PUBLIC, installSrc: installDb.toString() });
  }

  test('step 2 offers a plain request — no payment methods, no "payment details missing" block', async ({ page }) => {
    const r = await run(page, { email: 't@example.com' });
    expect(r.screen).toContain('שלח בקשת שיעור');
    expect(r.screen).not.toContain('טרם הגדיר');
    expect(r.screen).not.toContain('אמצעי תשלום');
    expect(r.screen).not.toContain('שילמתי');
  });

  test('the booking written has no payment method, reference code or commission fields', async ({ page }) => {
    const r = await run(page, { email: 't@example.com' });
    expect(r.written, 'the three-path booking write should have happened').not.toBeNull();
    const booking = r.written['bookings/bk1'];
    expect(booking.status).toBe('pending');
    expect(booking.price).toBe(60);
    for (const k of ['payMethod', 'payRef', 'grossAmount', 'commission', 'netToTeacher']) {
      expect(booking, `${k} must not be recorded`).not.toHaveProperty(k);
    }
  });
});
