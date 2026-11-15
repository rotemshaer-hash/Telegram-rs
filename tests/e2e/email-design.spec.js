const { test, expect } = require('@playwright/test');

// The browser sends some emails itself (welcome, lesson approved/rejected, parent notices). They must go out designed,
// from the same module as the server's, and fall back to readable text — never an empty message — if it did not load.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof sendEmail === 'function' && window.DrusheEmail);
}
const send = (page, drop) => page.evaluate(async (drop) => {
  const sent = [];
  window.emailjs = { send: async (svc, tpl, params) => { sent.push(params); return { status: 200 }; } };
  window._emailRateLimitOk = async () => true;
  if (drop) window.DrusheEmail = undefined;
  await sendEmail('parent@example.org', 'אישור שיעור', 'שלום,\n\n<b>x</b>\n\nhttps://drushe.com/?parentView=t\n\n– צוות Drushe');
  return sent[0];
}, drop);

test('a browser email carries the plain text and the designed HTML', async ({ page }) => {
  await boot(page);
  const p = await send(page, false);
  expect(p.message).toBe('שלום,\n\n<b>x</b>\n\nhttps://drushe.com/?parentView=t\n\n– צוות Drushe');
  expect(p.message_html).toMatch(/^<!doctype html>/);
  expect(p.message_html).toContain('לצפייה בפעילות');
  expect(p.message_html).toContain('https://drushe.com/terms.html');
  expect(p.message_html).not.toContain('<b>x</b>');           // typed markup is escaped
  expect(p.message_html).toContain('&lt;b&gt;x&lt;/b&gt;');
});

test('if the designer did not load, the email is escaped plain text — not empty', async ({ page }) => {
  await boot(page);
  const p = await send(page, true);
  expect(p.message_html.length).toBeGreaterThan(40);
  expect(p.message_html).toContain('&lt;b&gt;x&lt;/b&gt;');
  expect(p.message_html).toContain('dir="rtl"');
});

test('the links in client emails point at the primary domain', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => PUBLIC_SITE_URL)).toBe('https://drushe.com');
});
