const { test, expect } = require('@playwright/test');

// Drushe is not involved in lesson money (CLAUDE.md), so there is nothing a credit
// could be spent on: the card used to promise "₪15 credit" and "₪5 for the first
// lesson", the credit writes were refused by the rules, and the referral was never
// recorded. The card now only invites a friend; the referral is recorded and the
// referrer is told.

test('the referral card invites a friend and promises no credit', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Profile === 'function' && typeof go === 'function');
  const text = await page.evaluate(async () => {
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true, refCode: 'abc12' };
    S.pTab = 'about';
    go('profile');
    await new Promise((res) => setTimeout(res, 500));
    return document.getElementById('app').innerText;
  });
  expect(text).toContain('הזמן חבר');
  expect(text).not.toContain('קרדיט');
  expect(text).not.toContain('₪15');
  expect(text).not.toContain('₪5');
});

test('the profile menu does not call the lesson list "payments"', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Profile === 'function' && typeof go === 'function');
  const text = await page.evaluate(async () => {
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true };
    S.pTab = 'lessons';
    go('profile');
    await new Promise((res) => setTimeout(res, 500));
    return document.getElementById('app').innerText;
  });
  expect(text).not.toContain('ניהול תשלומים');
});
