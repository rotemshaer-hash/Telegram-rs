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
    expect(booking.jitsiUrl, 'the link is added by the teacher at approval').toBe('');
    for (const k of ['payMethod', 'payRef', 'grossAmount', 'commission', 'netToTeacher']) {
      expect(booking, `${k} must not be recorded`).not.toHaveProperty(k);
    }
  });

  // QA 29.10.2026: the teacher reads the booking record, and it carried the child's
  // email and the parent's email and name — details the teacher has no use for. The
  // parent is now mailed from the server (netlify/functions/lesson-mail.js).
  test('the booking written has no email or parent details of the child', async ({ page }) => {
    const r = await run(page, { email: 't@example.com' });
    const booking = r.written['teacherBookings/teach1/bk1'];
    expect(booking, 'the teacher copy must have been written').toBeTruthy();
    for (const k of ['studentEmail', 'parentEmail', 'parentName']) {
      for (const path of Object.keys(r.written)) {
        expect(r.written[path], k + ' must not be on ' + path).not.toHaveProperty(k);
      }
    }
  });

  // QA 29.10.2026: the link used to be copied from the teacher's private record by the
  // STUDENT's client at request time (so every approved student could read teacherPrivate,
  // and a link added later never reached a booking made earlier). Now the booking starts
  // without one and the teacher's own client adds the current link when approving.
  test('a booking starts without a meeting link; approving adds the teacher’s current one and asks the server to mail the parent', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof approveBooking === 'function' && typeof loadTeacherPrivate === 'function');
    const r = await page.evaluate(async ({ installSrc }) => {
      const writes = []; const calls = [];
      const nodes = {
        'bookings/bk9': { id: 'bk9', teacherId: 'teach1', studentId: 'stu', status: 'pending', day: "ב' 3 נוב", time: '10:00', studentName: 'ילד' },
        'teacherBookings/teach1': {},
        'teacherPrivate/teach1': { meetingLink: 'https://zoom.us/j/room' },
      };
      // eslint-disable-next-line no-new-func
      db = new Function('nodes', 'writes', `return (${installSrc})(nodes, writes)`)(nodes, writes);
      window.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse((init && init.body) || '{}') }); return { ok: true }; };
      currentUser = { uid: 'teach1', email: 't@example.com', emailVerified: true, getIdToken: async () => 'tok' };
      currentUserData = { name: 'מורה', role: 'teacher', verified: true };
      notifyUser = () => {}; loadTeacherBookings = async () => {}; render = () => {};
      await approveBooking('bk9');
      return { update: writes[0] || null, calls };
    }, { installSrc: installDb.toString() });
    expect(r.update, 'approving must write').not.toBeNull();
    expect(r.update['bookings/bk9/jitsiUrl']).toBe('https://zoom.us/j/room');
    expect(r.update['userBookings/stu/bk9/jitsiUrl']).toBe('https://zoom.us/j/room');
    expect(r.update['teacherBookings/teach1/bk9/status']).toBe('approved');
    const mail = r.calls.find((c) => c.url.includes('/api/lesson-mail'));
    expect(mail, 'the server mail must be requested').toBeTruthy();
    expect(mail.body).toMatchObject({ bookingId: 'bk9', event: 'approved' });
    expect(JSON.stringify(mail.body)).not.toMatch(/parentEmail|@/);
  });
});
