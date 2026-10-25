const { test, expect } = require('@playwright/test');

// Finding from reviewing the israeli-id-validator skill (25.10.2026) against
// our existing validateIsraeliId(): the old regex was /^\d{9}$/, exactly 9
// digits. About 1 in 10 real Teudat Zehut numbers start with 0, and a parent
// copying one from a document, PDF export, or their own memory routinely
// drops that leading zero — the field itself is type="tel", not a number
// input, so an 8-digit value reaches validateIsraeliId() unchanged and was
// rejected as "invalid ID" even though it's a real, correctly-issued number.
// Root cause: no zero-padding before the checksum. Fixed by padStart(9,'0')
// before computing the check digit, and explicitly rejecting "000000000"
// (which passes the Luhn-style checksum but is never a real ID).

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof validateIsraeliId === 'function');
}

test.describe('validateIsraeliId accepts a 9-digit ID missing its leading zero', () => {
  test('valid ID with leading zero typed', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => validateIsraeliId('123456782'));
    expect(result).toBe(true);
  });

  test('same ID with the leading zero dropped by the user', async ({ page }) => {
    await boot(page);
    // 012345674 is a valid ID (checksum 0) that happens to start with 0.
    const padded = await page.evaluate(() => validateIsraeliId('012345674'));
    const dropped = await page.evaluate(() => validateIsraeliId('12345674'));
    expect(padded).toBe(true);
    expect(dropped, 'an 8-digit real ID should still validate once zero-padded').toBe(true);
  });

  test('all-zeros is rejected even though it passes the checksum', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => validateIsraeliId('000000000'));
    expect(result).toBe(false);
  });

  test('a wrong check digit is still rejected', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => validateIsraeliId('123456789'));
    expect(result).toBe(false);
  });

  test('more than 9 digits is rejected, not silently truncated', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(() => validateIsraeliId('1234567820'));
    expect(result).toBe(false);
  });
});
