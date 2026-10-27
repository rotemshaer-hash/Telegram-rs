const { test, expect } = require('@playwright/test');

// Review finding (27.10.2026): the notifications panel built each subtitle from
// request/user-supplied fields (sender display name, groupTitle, preview...)
// and inserted it into innerHTML raw, so a user whose display name was an HTML
// payload ran script in every recipient's panel, admin included. The onclick
// also interpolated ids and names raw into single-quoted JS strings.
//
// Counting real DOM nodes, not matching strings: a broken escape would still
// "contain" the payload text.

const PAYLOAD = '<img src=x onerror="window.__xss=1">';
const JS_BREAKOUT = "');window.__xss=1;('";

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof showNotificationsPanel === 'function');
  await page.evaluate(() => {
    currentUser = { uid: 'me', email: 'me@example.com', emailVerified: true };
    currentUserData = { name: 'Me', role: 'student', verified: true, createdAt: Date.now() };
    window.__xss = 0;
  });
}

test.describe('the notifications panel escapes user-controlled fields', () => {
  test('a hostile sender name / group title renders as text, not an element', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate((payload) => {
      unreadCount = 0;
      notifications = [
        { id: 'n1', type: 'newMessage', from: payload, preview: payload, createdAt: Date.now(), read: true },
        { id: 'n2', type: 'groupApproved', groupTitle: payload, createdAt: Date.now(), read: true },
        { id: 'n3', type: 'newBooking', from: payload, createdAt: Date.now(), read: true },
      ];
      showNotificationsPanel();
      return {
        injectedImages: document.querySelectorAll('img[src="x"]').length,
        xssFired: window.__xss,
        showsLiteralText: document.body.innerText.includes('onerror'),
      };
    }, PAYLOAD);

    expect(res.injectedImages, 'payload became a real <img> element').toBe(0);
    expect(res.xssFired, 'injected handler executed').toBe(0);
    expect(res.showsLiteralText, 'payload should be visible as literal text').toBe(true);
  });

  test('a hostile id/name cannot break out of the inline onclick', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate((breakout) => {
      unreadCount = 0;
      notifications = [
        { id: breakout, type: 'rateLesson', bookingId: breakout, teacherId: breakout, teacherName: breakout, createdAt: Date.now(), read: true },
        { id: 'n2', type: 'newMessage', fromUid: breakout, from: 'x', createdAt: Date.now(), read: true },
      ];
      showNotificationsPanel();
      document.querySelectorAll('._notifPanel > div[onclick]').forEach((el) => {
        try { el.click(); } catch (e) { /* the handlers may throw on missing app state; only __xss matters */ }
      });
      return { xssFired: window.__xss };
    }, JS_BREAKOUT);

    expect(res.xssFired, 'an id/name broke out of the onclick string and ran').toBe(0);
  });
});
