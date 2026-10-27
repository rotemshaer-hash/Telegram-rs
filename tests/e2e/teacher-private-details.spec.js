const { test, expect } = require('@playwright/test');

// A teacher's email, notification email and meeting link live in
// teacherPrivate/<uid> (not in the world-readable teachers/<uid>), and lesson
// payment details are not collected at all. These drive the real screens,
// the real save and the real login-time migration against a recording db.

const UID = 'teacher-under-test';

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof saveTeacherProfileEdits === 'function' && typeof _migrateLegacyTeacherPrivate === 'function');
  await page.evaluate((uid) => {
    window.__writes = [];
    const rec = (op, path) => (v) => { window.__writes.push([op, path, v]); return Promise.resolve(); };
    const ref = (path) => ({
      set: rec('set', path), update: rec('update', path), remove: rec('remove', path),
      get: async () => ({ exists: () => false, val: () => null, forEach: () => {} }),
      push: () => ({ key: 'k1', set: rec('set', path) }),
      child: (p) => ref(path + '/' + p),
    });
    db = { ref };
    currentUser = { uid, email: 't@example.com', emailVerified: true };
    currentUserData = { name: 'יונתן', role: 'teacher', verified: true };
  }, UID);
}

const words = (n) => Array.from({ length: n }, (_, i) => 'מילה' + i).join(' ');

test.describe('teacher private details', () => {
  test('the registration screen no longer asks for payment details', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      S.screen = 'teacherSetup'; render();
      const app = document.getElementById('app');
      return {
        payInputs: ['tPayBit', 'tPayPaypal', 'tPayPaybox'].filter((id) => document.getElementById(id)),
        asksForPayment: /אמצעי תשלום אחד|פרטי תשלום לקבלת כספים/.test(app.innerText),
        hasMeetingLink: !!document.getElementById('tMeetingLink'),
      };
    });
    expect(r.payInputs).toEqual([]);
    expect(r.asksForPayment).toBe(false);
    expect(r.hasMeetingLink).toBe(true);
  });

  test('registering a teacher writes email and meeting link to teacherPrivate first, and puts none of the private fields on the public record', async ({ page }) => {
    await boot(page);
    const writes = await page.evaluate(async ({ longText }) => {
      S.screen = 'teacherSetup'; render();
      _selectedCats = ['chess']; _customCats = []; _modeOnline = true; _modeFrontal = false;
      const area = document.getElementById('tArea');
      area.value = [...area.options].map((o) => o.value).find(Boolean);
      document.getElementById('tCity').value = 'תל אביב';
      document.getElementById('tPrice').value = '60';
      document.getElementById('tDesc').value = longText;
      document.getElementById('tAge').value = '16';
      document.getElementById('tIdType').value = 'parent_confirm';
      document.getElementById('tMeetingLink').value = 'https://zoom.us/j/55';
      kcbChecked = () => true;
      sendAdminEmail = async () => {}; notifyAdmin = async () => {};
      await saveTeacherProfile().catch(() => {});
      return window.__writes;
    }, { longText: words(25) });

    const iPriv = writes.findIndex((w) => w[1] === 'teacherPrivate/teacher-under-test');
    const iPub = writes.findIndex((w) => w[1] === 'teachers/teacher-under-test' && w[0] === 'set');
    expect(iPriv, 'teacherPrivate write').toBeGreaterThanOrEqual(0);
    expect(iPub, 'public teachers write').toBeGreaterThanOrEqual(0);
    expect(iPriv, 'private first, so a saved profile never lacks its private details').toBeLessThan(iPub);
    expect(writes[iPriv][2]).toMatchObject({ email: 't@example.com', meetingLink: 'https://zoom.us/j/55' });
    for (const k of ['payment', 'email', 'meetingLink', 'notificationEmail']) {
      expect(writes[iPub][2], `${k} must not be on the public record`).not.toHaveProperty(k);
    }
  });

  test('the edit dialog fills the meeting link and notification email from teacherPrivate, with no payment fields', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate((uid) => {
      TEACHERS.push({ id: uid, name: 'יונתן', cats: ['chess'], cat: 'chess', customCats: [], price: 60 });
      _teacherPrivateCache[uid] = { meetingLink: 'https://zoom.us/j/777', notificationEmail: 'n@example.com', email: 't@example.com' };
      showEditTeacherProfileDialog();
      return {
        link: document.getElementById('_etMeetingLink')?.value,
        notif: document.getElementById('_etNotifEmail')?.value,
        payInputs: ['_etPayBit', '_etPayPaypal', '_etPayPaybox'].filter((id) => document.getElementById(id)),
      };
    }, UID);
    expect(r.link).toBe('https://zoom.us/j/777');
    expect(r.notif).toBe('n@example.com');
    expect(r.payInputs).toEqual([]);
  });

  test('saving the profile writes the private fields to teacherPrivate and clears the public copies', async ({ page }) => {
    await boot(page);
    const writes = await page.evaluate(async ({ uid, longText }) => {
      TEACHERS.push({ id: uid, name: 'יונתן', cats: ['chess'], cat: 'chess', customCats: [], price: 60 });
      _teacherPrivateCache[uid] = {};
      document.body.insertAdjacentHTML('beforeend',
        '<input id="_etName" value="יונתן"><input id="_etPrice" value="60"><input id="_etMeetingLink" value="https://zoom.us/j/9">'
        + '<input id="_etNotifEmail" value="n@example.com"><textarea id="_etDesc_chess"></textarea><input id="_etTags_chess" value="">');
      document.getElementById('_etDesc_chess').value = longText;
      window._etCats = ['chess'];
      await saveTeacherProfileEdits();
      return window.__writes;
    }, { uid: UID, longText: words(25) });

    const priv = writes.find((w) => w[1] === `teacherPrivate/${UID}`);
    expect(priv, 'a write to teacherPrivate/<uid>').toBeTruthy();
    expect(priv[2]).toMatchObject({ meetingLink: 'https://zoom.us/j/9', notificationEmail: 'n@example.com' });
    expect(priv[2]).not.toHaveProperty('payment');
    const pub = writes.find((w) => w[1] === `teachers/${UID}` && w[0] === 'update' && 'payment' in w[2]);
    expect(pub, 'the public node update that clears the old copies').toBeTruthy();
    expect(pub[2]).toMatchObject({ payment: null, meetingLink: null, notificationEmail: null, email: null });
  });

  test('migration: private values are written BEFORE the public copy is deleted, and legacy payment is dropped, not copied', async ({ page }) => {
    await boot(page);
    const writes = await page.evaluate(async (uid) => {
      await _migrateLegacyTeacherPrivate(uid, { payment: { bit: '050' }, email: 'old@example.com', meetingLink: 'https://zoom.us/j/1' });
      return window.__writes;
    }, UID);
    const iPriv = writes.findIndex((w) => w[1] === `teacherPrivate/${UID}`);
    const iPub = writes.findIndex((w) => w[1] === `teachers/${UID}`);
    expect(iPriv, 'private write happened').toBeGreaterThanOrEqual(0);
    expect(iPub, 'public cleanup happened').toBeGreaterThanOrEqual(0);
    expect(iPriv, 'copy first, delete second').toBeLessThan(iPub);
    expect(writes[iPriv][2]).toMatchObject({ email: 'old@example.com', meetingLink: 'https://zoom.us/j/1' });
    expect(writes[iPriv][2]).not.toHaveProperty('payment');
    expect(writes[iPub][2]).toMatchObject({ payment: null });
  });

  test('migration: a record with only legacy payment just gets it deleted', async ({ page }) => {
    await boot(page);
    const writes = await page.evaluate(async (uid) => {
      await _migrateLegacyTeacherPrivate(uid, { payment: { bit: '050' } });
      return window.__writes;
    }, UID);
    expect(writes.some((w) => w[1] === `teacherPrivate/${UID}`)).toBe(false);
    expect(writes.find((w) => w[1] === `teachers/${UID}`)[2]).toMatchObject({ payment: null });
  });

  test('migration: a clean record is left alone', async ({ page }) => {
    await boot(page);
    const writes = await page.evaluate(async (uid) => {
      await _migrateLegacyTeacherPrivate(uid, { name: 'x', verified: true });
      return window.__writes;
    }, UID);
    expect(writes).toEqual([]);
  });
});
