const { test, expect } = require('@playwright/test');

// A teacher with more than one subject sees a tab row (profile screen —
// category, then bookings/wallet/portfolio/achievements/about) that is wider
// than the phone screen. `.tabs.scroll` already scrolled — its scrollbar is
// deliberately hidden (see the CSS comment) — but with nothing telling the
// user more tabs exist past the edge, the owner went looking for "אודות"
// (about) and could not find it, because it was the last tab and simply off
// screen. This is not a code error; the app never threw. It is a real bug
// that only a person actually trying the app would find, and did.
//
// _markScrollableTabRows() is the fix: it runs after every render() and
// tags a `.tabs.scroll` row with `can-scroll` only when it genuinely
// overflows (scrollWidth > clientWidth), which is what the CSS uses to draw
// the edge-fade hint. Tested here directly against a DOM fixture rather than
// through a real teacher login, because the function's whole job is a
// scrollWidth/clientWidth comparison — a fixture exercises exactly that,
// without needing to fabricate an authenticated multi-category teacher.
test.describe('the scroll hint on horizontally-scrolling tab rows', () => {
  test('a row wider than its container is marked scrollable', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const marked = await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'tabs scroll';
      row.style.width = '200px'; // narrower than the buttons below
      for (const label of ['כדורגל', 'שחמט', 'הזמנות', 'ארנק', 'תיק עבודות', 'הישגים', 'אודות']) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.minWidth = '80px';
        row.appendChild(b);
      }
      document.body.appendChild(row);
      window._markScrollableTabRows();
      const result = row.classList.contains('can-scroll');
      row.remove();
      return result;
    });
    expect(marked).toBe(true);
  });

  test('a row that already fits is not marked, so the fade never covers real content', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const marked = await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'tabs scroll';
      row.style.width = '600px';
      for (const label of ['כדורגל', 'אודות']) {
        const b = document.createElement('button');
        b.textContent = label;
        row.appendChild(b);
      }
      document.body.appendChild(row);
      window._markScrollableTabRows();
      const result = row.classList.contains('can-scroll');
      row.remove();
      return result;
    });
    expect(marked).toBe(false);
  });
});
