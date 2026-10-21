const { test, expect } = require('@playwright/test');

// Profile photos were written as a base64 data URL straight into
// users/$uid/photo and teachers/$uid/photo. loadRealTeachers fetches the
// whole `teachers` node once per session with no limitTo — so every photo
// of every teacher rode along on every discover-screen load, for every
// user, every time. At 3,000 teachers that is 120-200MB of text just to
// show a list.
//
// The fix routes the photo through Firebase Storage (the same path
// id-photos, stories and portfolio already use) and stores only the
// resulting URL in the database. This test drives uploadProfilePhoto
// directly — the same way minor-privacy.spec.js drives adminApproveTeacher
// — and asserts on what actually gets written, not on the UI around it.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof uploadProfilePhoto === 'function');
}

test.describe('profile photos go through Storage, never base64 into the DB', () => {
  async function upload(page, role) {
    return page.evaluate(async (r) => {
      const calls = { storagePath: null, dbWrites: {} };
      window._resizeFileForProfile = () => Promise.resolve('data:image/jpeg;base64,AAAA');
      window.uploadBase64ToStorage = (dataUrl, path) => {
        calls.storagePath = path;
        calls.gotDataUrl = dataUrl;
        return Promise.resolve('https://firebasestorage.example/fake-photo.jpg');
      };
      window.showFireToast = () => {};
      window.render = () => {};
      currentUser = { uid: 'u1' };
      currentUserData = { role: r };
      if (r === 'teacher') TEACHERS.push({ id: 'u1' });
      db = { ref: (p) => ({ set: (v) => { calls.dbWrites[p] = v; return Promise.resolve(); } }) };

      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'profilePhotoInput';
      Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] });
      document.body.appendChild(input);
      await uploadProfilePhoto();
      input.remove();
      return calls;
    }, role);
  }

  test('a student upload is stored as a Storage URL under the right uid', async ({ page }) => {
    await boot(page);
    const r = await upload(page, 'student');
    expect(r.storagePath, 'the photo must go to profilePhotos/<uid>/..., not a path guessed on the spot').toMatch(/^profilePhotos\/u1\//);
    expect(r.gotDataUrl).toContain('data:image/jpeg');
    expect(r.dbWrites['users/u1/photo']).toBe('https://firebasestorage.example/fake-photo.jpg');
    expect(r.dbWrites['teachers/u1/photo'], 'students have no teachers/ record').toBeUndefined();
  });

  test('a teacher upload also mirrors the URL into teachers/, never the raw image', async ({ page }) => {
    await boot(page);
    const r = await upload(page, 'teacher');
    expect(r.dbWrites['users/u1/photo']).toBe('https://firebasestorage.example/fake-photo.jpg');
    expect(r.dbWrites['teachers/u1/photo']).toBe('https://firebasestorage.example/fake-photo.jpg');
    for (const v of Object.values(r.dbWrites)) {
      expect(v.startsWith('data:'), 'no base64 image may reach the database again').toBe(false);
    }
  });
});
