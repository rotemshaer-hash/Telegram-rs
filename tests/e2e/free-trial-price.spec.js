const { test, expect } = require('@playwright/test');

// A teacher can mark "free trial lesson"; the profile showed the badge, but the
// trial card, the type picker and the booking each computed half price on their
// own and ignored the flag, so a student saw "free trial" and paid half.

test('trial price: free when the teacher offers it, half otherwise, one definition', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof trialPrice === 'function' && typeof Booking === 'function');
  const r = await page.evaluate(async () => {
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true };
    const mk = (freeTrial) => ({ id: 'teach1', name: 'מורה', cat: 'chess', cats: ['chess'], price: 60, freeTrial });
    const out = { free: trialPrice(mk(true)), half: trialPrice(mk(false)), label: trialPriceLabel(mk(true)), labelHalf: trialPriceLabel(mk(false)) };
    TEACHERS.length = 0; TEACHERS.push(mk(true));
    S.bookStep = 1; S.bookType = 'trial'; S.bookDayIdx = 1; S.bookTime = '10:00';
    go('booking', { teacher: TEACHERS[0] });
    await new Promise((res) => setTimeout(res, 300));
    out.picker = document.getElementById('app').innerText;
    S.bookStep = 2; render(); await new Promise((res) => setTimeout(res, 300));
    out.step2 = document.getElementById('app').innerText;
    return out;
  });
  expect(r.free).toBe(0);
  expect(r.half).toBe(30);
  expect(r.label).toBe('חינם');
  expect(r.labelHalf).toBe('₪30');
  expect(r.picker).toContain('חינם');
  expect(r.step2).toContain('₪0');
});
