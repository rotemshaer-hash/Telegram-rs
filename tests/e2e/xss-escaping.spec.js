const { test, expect } = require('@playwright/test');

// The whole UI is built from template literals assigned to innerHTML, so a
// single unescaped ${...} is a stored-XSS hole. These are the ones where the
// value is written by a DIFFERENT user than the one looking at the screen —
// the cases where an attacker can reach a victim.
//
// The chat header is the sharpest: S.chat.otherName is populated from the
// SENDER's own fromName (see the userChats writes around line 4271), so anyone
// who can start a chat controls a string rendered on the other person's device.
//
// A payload is only "escaped" if the browser produced TEXT, not an element.
// Asserting on the HTML string would pass even for a broken escape, so these
// tests count real DOM nodes.

const PAYLOAD = '<img src=x onerror="window.__xss=1">';
const ATTR_PAYLOAD = '" autofocus onfocus="window.__xss=1';

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof render === 'function');
  await page.evaluate(() => {
    currentUser = { uid: 'me', email: 'me@example.com', emailVerified: true };
    currentUserData = { name: 'Me', role: 'student', verified: true, createdAt: Date.now() };
    window.__xss = 0;
  });
}

test.describe('user-controlled text is escaped before it reaches innerHTML', () => {
  test('a hostile display name in the chat header renders as text, not an element', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate((payload) => {
      S.chat = { otherUid: 'attacker', otherName: payload };
      S.screen = 'chat';
      render();
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

  test('a hostile name in the profile edit field cannot break out of the attribute', async ({ page }) => {
    await boot(page);
    const res = await page.evaluate((payload) => {
      currentUserData.name = payload;
      S.screen = 'profile';
      render();
      // The field lives in a dialog, not in a screen render.
      showEditProfileDialog();
      const el = document.getElementById('_epName');
      return {
        found: !!el,
        // If the quote escaped the attribute, the value would be truncated and
        // the rest would have become markup.
        valueIntact: el ? el.value === payload : null,
        xssFired: window.__xss,
      };
    }, ATTR_PAYLOAD);

    // Assert the field was actually rendered. A test that silently skips its
    // own assertion when the element is missing passes on broken code too.
    expect(res.found, 'the name field was not rendered — the test proved nothing').toBe(true);
    expect(res.xssFired, 'attribute break-out executed a handler').toBe(0);
    expect(res.valueIntact, 'attribute value was truncated at the quote').toBe(true);
  });
});
