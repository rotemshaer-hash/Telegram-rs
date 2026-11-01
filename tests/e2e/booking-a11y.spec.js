const { test, expect } = require('@playwright/test');

// QA 29.10.2026: day buttons 36px wide, hour slots with no role or keyboard, the
// pressed state announced nowhere, a white circle on the confirmation (the app's own
// rule: no white surfaces), two near-identical rows, and the "→" between the three
// steps pointing the way an RTL reader does not read.

const open = async (page, step) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Booking === 'function' && typeof go === 'function');
  await page.evaluate(async (step) => {
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true };
    const t = { id: 'teach1', name: 'מורה', cat: 'chess', cats: ['chess'], price: 60 };
    TEACHERS.length = 0; TEACHERS.push(t);
    S.bookStep = step; S.bookType = 'single'; S.bookDayIdx = 1; S.bookTime = '10:00';
    go('booking', { teacher: t });
    await new Promise((r) => setTimeout(r, 400));
  }, step);
};

test('day buttons are at least 44px, announce what they are, and say when they are pressed', async ({ page }) => {
  await open(page, 1);
  const days = page.locator('.day-btn');
  await expect(days.first()).toHaveAttribute('aria-label', /.+/);
  const pressed = await page.locator('.day-btn[aria-pressed="true"]').count();
  expect(pressed).toBe(1);
  const box = await days.first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test('hour slots are buttons for the keyboard and screen readers, 44px tall', async ({ page }) => {
  await open(page, 1);
  const slot = page.locator('.slot').first();
  await expect(slot).toHaveAttribute('role', 'button');
  await expect(slot).toHaveAttribute('tabindex', '0');
  expect((await slot.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.locator('.slot[aria-pressed="false"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.slot[aria-pressed="true"]')).toHaveCount(1);
});

test('the back button in the header is a 44px target', async ({ page }) => {
  await open(page, 2);
  const back = page.getByRole('button', { name: /חזור/ }).first();
  expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(44);
});

test('step 3 has no white circle and no repeated row', async ({ page }) => {
  await open(page, 3);
  const html = await page.evaluate(() => document.getElementById('app').innerHTML);
  expect(html).not.toMatch(/width:88px;height:88px;border-radius:50%;background:#fff/);
  const text = await page.evaluate(() => document.getElementById('app').innerText);
  expect(text).not.toContain('המורה יאשר ויחכה לך');
});

test('the arrows between the three steps point left, the reading direction in Hebrew', async ({ page }) => {
  await open(page, 2);
  const text = await page.evaluate(() => document.getElementById('app').innerText);
  expect(text).not.toMatch(/שולחים בקשה\s*→/);
});
