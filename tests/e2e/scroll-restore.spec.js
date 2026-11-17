const { test, expect } = require('@playwright/test');

// render() restores the page's scroll position when it redraws the same screen,
// so an incoming message doesn't throw the user back to the top. Navigation and
// filters *ask* for the top, and render() can't tell them apart by screen name:
// tapping the active tab is "the same screen". The restore runs in a rAF, after
// go()'s reset, and used to win. It only stayed hidden while body (not the
// window) was the scroller, because the restore then always read 0.

async function goHome(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('[onclick="browseAsGuest()"]').click();
  await expect(page.locator('#app')).toContainText('Drushe', { timeout: 10000 });
}

const scrollPos = (page) =>
  page.evaluate(() => Math.max(scrollY, document.documentElement.scrollTop, document.body.scrollTop));

// Waits until the wheel scroll has settled: a click during an in-flight scroll
// cancels a smooth scrollTo, which is browser behaviour, not the bug under test.
async function scrollDown(page) {
  await page.mouse.move(200, 300);
  await page.mouse.wheel(0, 600);
  let last = -1;
  await expect.poll(async () => {
    const now = await scrollPos(page);
    const settled = now === last && now > 300;
    last = now;
    return settled;
  }, { intervals: [150] }).toBe(true);
}

test.describe('scroll position across renders', () => {
  test('tapping the active bottom-nav tab returns to the top', async ({ page }) => {
    await goHome(page);
    await scrollDown(page);
    await page.locator('.bnav button').first().click();
    // Not a poll: the page is at 0 for a moment right after the click, and the
    // bug puts it back one frame later. Read after that frame has passed.
    await page.waitForTimeout(800);
    expect(await scrollPos(page)).toBe(0);
  });

  test('a group filter returns to the top', async ({ page }) => {
    await goHome(page);
    await scrollDown(page);
    await page.locator('button[onclick*="S.groupFilter="]').first().evaluate((b) => b.click());
    await expect.poll(() => scrollPos(page), { timeout: 3000 }).toBe(0);
  });

  test('an unrequested redraw of the same screen keeps the position', async ({ page }) => {
    await goHome(page);
    await scrollDown(page);
    const before = await scrollPos(page);
    await page.evaluate(() => render());
    await page.waitForTimeout(500);
    expect(await scrollPos(page)).toBe(before);
  });
});
