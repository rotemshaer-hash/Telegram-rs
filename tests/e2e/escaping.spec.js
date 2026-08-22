const { test, expect } = require('@playwright/test');

// A teacher writes their own name and photo to teachers/<uid>, and every
// device that loads the teacher list reads them back and renders them into
// HTML. The database rules let a teacher change those fields *after* the
// admin has approved them, so manual approval is not a gate here — which is
// what makes escaping the only thing standing between a hostile display name
// and script running in every viewer's session, minors included.
//
// These tests drive the real render functions with hostile values rather
// than asserting on the source, so they keep holding if the markup is
// rewritten.

const HOSTILE_NAME = '<img src=x onerror="window.__xss=1">Dana';
const HOSTILE_PHOTO = 'x" onerror="window.__xss=1" data-x="';

test.describe('user-supplied values cannot inject HTML', () => {
  test('a hostile teacher name renders as text in the leaderboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(({ name }) => {
      LEADERBOARD.length = 0;
      LEADERBOARD.push({
        rank: 1, name, av: '🎓', col: '#14B8A6',
        cat: 'מתמטיקה', lessons: 5, rating: 4.5,
      });
      const host = document.createElement('div');
      host.innerHTML = Leaderboard();
      document.body.appendChild(host);
      return {
        injected: host.querySelectorAll('img').length,
        text: host.textContent.includes(name),
      };
    }, { name: HOSTILE_NAME });

    expect(result.injected, 'the name produced a real <img> element').toBe(0);
    expect(result.text, 'the name should still be visible as literal text').toBe(true);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('a hostile photo value cannot break out of the avatar src attribute', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const attrs = await page.evaluate(({ photo, name }) => {
      const host = document.createElement('div');
      host.innerHTML = avatarHtml(photo, name);
      document.body.appendChild(host);
      const img = host.querySelector('img');
      return { src: img && img.getAttribute('src'), onerror: img && img.getAttribute('onerror') };
    }, { photo: HOSTILE_PHOTO, name: 'Dana' });

    // The whole hostile string must land inside src as one value; an onerror
    // attribute existing at all means the quote was closed and we escaped
    // into attribute position.
    expect(attrs.onerror, 'the photo value created an event-handler attribute').toBeNull();
    expect(attrs.src).toBe(HOSTILE_PHOTO);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  // The initials path takes at most two characters, so it cannot carry a
  // whole tag and no exploit is claimed here. What it can do is emit a bare
  // "<", which the parser swallows along with whatever follows — the initial
  // silently disappears from the avatar. Asserting the character survives as
  // text is the honest version of this check: it is a correctness guarantee,
  // and it happens to be what keeps the path escaped.
  test('avatar initials render as literal characters', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const text = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = avatarHtml(null, '<hai Bee');
      document.body.appendChild(host);
      return host.textContent;
    });

    expect(text).toBe('<B');
  });
});
