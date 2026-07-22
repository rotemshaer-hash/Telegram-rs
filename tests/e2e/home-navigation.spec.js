const { test, expect } = require('@playwright/test');

// Covers the category drill-down navigation (group -> categories -> back)
// that was the subject of a full design rewrite this session. This is
// exactly the kind of flow a future data-loading refactor (Phase 0 DB
// architecture item) must not silently break — having it under test now
// is what makes that refactor safe to attempt later.

async function goHome(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('[onclick="browseAsGuest()"]').click();
  await expect(page.locator('#app')).toContainText('Drushe', { timeout: 10000 });
}

test.describe('Home screen category navigation', () => {
  test('shows the top-level subject groups', async ({ page }) => {
    await goHome(page);
    await expect(page.getByText('לימודים', { exact: true })).toBeVisible();
    await expect(page.getByText('אמנות', { exact: true })).toBeVisible();
    await expect(page.getByText('ספורט', { exact: true })).toBeVisible();
  });

  test('clicking a group drills into its categories, and back returns to groups', async ({ page }) => {
    await goHome(page);

    await page.getByText('לימודים', { exact: true }).click();
    // Drilled-down view shows a category count badge and a back arrow.
    await expect(page.getByText('נושאים')).toBeVisible();

    await page.locator('button:has-text("→")').first().click();
    await expect(page.getByText('לימודים', { exact: true })).toBeVisible();
    await expect(page.getByText('אמנות', { exact: true })).toBeVisible();
  });
});
