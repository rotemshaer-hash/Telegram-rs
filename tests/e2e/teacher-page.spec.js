const { test, expect } = require('@playwright/test');

// The teacher page (screen 'teacher') is split into tabs — overview, videos,
// reviews, questions — and every description a teacher writes must be at
// least MIN_DESC_WORDS words. These tests drive the real index.html against
// the mocked Firebase.

const TEACHER = {
  id: 'teacher-under-test', name: 'יונתן לוי', age: 16, city: 'תל אביב',
  cat: 'football', cats: ['football', 'chess'], customCats: [],
  price: 60, rating: 4.9, reviews: 0, lessons: 34, mode: ['online'],
  av: '⚽', photo: null, col: '#27AE60', badge: 'מורה מוסמך', online: true, group: false,
  desc: 'תיאור', tags: [], catProfiles: {},
};

async function openTeacher(page, { viewerUid = null, tab = null } = {}) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof go === 'function' && typeof SCREENS === 'object');
  await page.evaluate(({ t, viewerUid, tab }) => {
    if (viewerUid) {
      currentUser = { uid: viewerUid, email: viewerUid + '@example.com', emailVerified: true };
      currentUserData = { name: 'צופה', role: 'student', verified: true };
    }
    TEACHERS.push(t);
    if (tab) { S._tabFor = t.id; S.teacherTab = tab; }
    go('teacher', { teacher: t });
  }, { t: TEACHER, viewerUid, tab });
  await expect(page.locator('.tp-tabs')).toBeVisible();
}

// Replaces the plain `var db` with a recorder, so a save that should be
// refused can be shown to have written nothing at all.
async function recordWrites(page) {
  await page.evaluate(() => {
    window.__writes = [];
    const ref = (path) => ({
      set: (v) => { window.__writes.push(['set', path, v]); return Promise.resolve(); },
      update: (v) => { window.__writes.push(['update', path, v]); return Promise.resolve(); },
      child: (p) => ref(path + '/' + p),
    });
    db = { ref };
    currentUser = { uid: 'teacher-under-test', email: 't@example.com', emailVerified: true };
  });
}

const words = (n) => Array.from({ length: n }, (_, i) => 'מילה' + i).join(' ');

test.describe('the 20-word minimum on teacher descriptions', () => {
  test('counts words, not characters', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof countWords === 'function');
    const r = await page.evaluate(() => ({
      min: MIN_DESC_WORDS,
      spaced: countWords('  אחת   שתיים\nשלוש  '),
      empty: countWords(''),
      // 25 characters but only one word — the old 20-character rule let this through
      longWord: countWords('אאאאאאאאאאאאאאאאאאאאאאאאא'),
    }));
    expect(r).toEqual({ min: 20, spaced: 3, empty: 0, longWord: 1 });
  });

  for (const [name, setup, call, writePath] of [
    ['a single subject profile', `
      document.body.insertAdjacentHTML('beforeend','<textarea id="_ecDesc"></textarea><input id="_ecTags" value="">');`,
      "saveCatProfileEdits('football')", 'catProfiles/football'],
    ['the subject edit sheet', `
      document.body.insertAdjacentHTML('beforeend','<textarea id="_esDesc"></textarea><input id="_esTags" value=""><input id="_esPrice" value="60"><input id="_esCity" value="תל אביב">');`,
      "_saveSubjectEdit('football')", 'catProfiles/football'],
    ['the full profile edit', `
      document.body.insertAdjacentHTML('beforeend','<input id="_etName" value="יונתן"><input id="_etPrice" value="60"><input id="_etPayBit" value="0501234567"><textarea id="_etDesc_football"></textarea><input id="_etTags_football" value="">');
      window._etCats=['football'];`,
      'saveTeacherProfileEdits()', 'teachers/teacher-under-test'],
  ]) {
    test(`${name}: refuses a short description, saves a long enough one`, async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof descTooShort === 'function');
      await recordWrites(page);
      await page.evaluate(setup);
      const descId = name === 'a single subject profile' ? '_ecDesc' : name === 'the subject edit sheet' ? '_esDesc' : '_etDesc_football';

      await page.evaluate(({ id, text }) => { document.getElementById(id).value = text; }, { id: descId, text: words(19) });
      await page.evaluate(`(async()=>{await ${call};})()`);
      expect(await page.evaluate(() => window.__writes.length), '19 words must not be saved').toBe(0);

      await page.evaluate(({ id, text }) => { document.getElementById(id).value = text; }, { id: descId, text: words(20) });
      await page.evaluate(`(async()=>{await ${call};})()`);
      const paths = await page.evaluate(() => window.__writes.map((w) => w[1]));
      expect(paths.some((p) => p.includes(writePath)), '20 words must be saved: ' + paths.join(', ')).toBe(true);
    });
  }

  test('the live counter updates as the teacher types', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof descWordCounter === 'function');
    const out = await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<div id="wcHost"><textarea id="wcTa" oninput="_updDescWc(this)"></textarea>' + descWordCounter('') + '</div>');
      const ta = document.getElementById('wcTa');
      const before = ta.nextElementSibling.textContent;
      ta.value = Array.from({ length: 21 }, () => 'מילה').join(' ');
      _updDescWc(ta);
      return { before, after: ta.nextElementSibling.textContent };
    });
    expect(out.before).toContain('0/20');
    expect(out.after).toContain('21/20');
  });
});

test.describe('the teacher page tabs', () => {
  test('opens on the overview, and each tab shows its own section', async ({ page }) => {
    await openTeacher(page);
    await expect(page.locator('.tp-tab.on')).toHaveText('סקירה');
    await expect(page.locator('#app')).toContainText('קצת עליי');

    await page.locator('.tp-tab', { hasText: 'ביקורות' }).click();
    await expect(page.locator('#_reviewsSection')).toBeVisible();

    await page.locator('.tp-tab', { hasText: 'שאלות' }).click();
    await expect(page.locator('#_qaSection')).toBeVisible();
    await expect(page.locator('#_reviewsSection')).toHaveCount(0);
  });

  test('another user still gets the report and favorite buttons', async ({ page }) => {
    await openTeacher(page, { viewerUid: 'someone-else' });
    await expect(page.locator('button[onclick^="showReportDialog(\'teacher\'"]')).toHaveCount(1);
    await expect(page.locator('button[onclick^="toggleFavorite("]')).toHaveCount(1);
    await expect(page.getByText('קבע שיעור עכשיו')).toBeVisible();
  });

  test('a teacher viewing their own page cannot report or book themselves', async ({ page }) => {
    await openTeacher(page, { viewerUid: TEACHER.id });
    await expect(page.locator('button[onclick^="showReportDialog("]')).toHaveCount(0);
    await expect(page.getByText('קבע שיעור עכשיו')).toHaveCount(0);
  });

  test('a question notification lands on the questions tab', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _notifGoToQA === 'function');
    await page.evaluate((t) => { TEACHERS.push(t); _notifGoToQA(t.id); }, TEACHER);
    await expect(page.locator('#_qaSection')).toBeVisible();
    await expect(page.locator('.tp-tab.on')).toContainText('שאלות');
  });
});
