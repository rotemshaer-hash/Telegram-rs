const { test, expect } = require('@playwright/test');

// An uncaught error was already written to clientErrors — and then sat there until
// someone opened the admin panel. The wiring that turns that write into an alert is
// four lines inside the error handler at the top of index.html, far from anything a
// feature test touches, so it is exactly the kind of line a later edit drops silently.
//
// These tests assert the real browser path: the handler fires, the record is written,
// and only then does a call go out to /api/error-alert carrying the record's key and
// nothing else. The error text is deliberately NOT in the request — the server reads
// it from the database, so a caller cannot put words in the admin's inbox.

async function boot(page, calls) {
  await page.route('**/api/error-alert', async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"sent":1}' });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window._reportClientError === 'function');
  // Stand in for the database: a thenable that carries a key, exactly like push() returns.
  await page.evaluate(() => {
    window.__pushed = null;
    const thenable = Promise.resolve();
    thenable.key = 'FAKE-ERROR-KEY';
    db = { ref: (p) => ({ push: (v) => { window.__pushed = { path: p, value: v }; return thenable; } }) };
  });
}

test.describe('an uncaught error alerts the admin, not just the database', () => {
  test('writes the error and then calls the alert endpoint with its key', async ({ page }) => {
    const calls = [];
    await boot(page, calls);
    await page.evaluate(() => window._reportClientError('boom from a screen', { source: 'index.html', lineno: 4120 }));
    await expect.poll(() => calls.length, { timeout: 5000 }).toBe(1);

    expect(calls[0]).toEqual({ errorId: 'FAKE-ERROR-KEY' });
    const pushed = await page.evaluate(() => window.__pushed);
    expect(pushed.path).toBe('clientErrors');
    expect(pushed.value.message).toBe('boom from a screen');
    expect(pushed.value.lineno).toBe(4120);
    expect(typeof pushed.value.createdAt).toBe('number');
  });

  test('a real uncaught exception travels the same path', async ({ page }) => {
    const calls = [];
    await boot(page, calls);
    await page.evaluate(() => { setTimeout(() => { throw new Error('a real uncaught error'); }, 0); });
    await expect.poll(() => calls.length, { timeout: 5000 }).toBe(1);
    const pushed = await page.evaluate(() => window.__pushed);
    expect(pushed.value.message).toContain('a real uncaught error');
  });

  test('the same error does not call twice in one page load', async ({ page }) => {
    const calls = [];
    await boot(page, calls);
    await page.evaluate(() => {
      window._reportClientError('same thing', { source: 'index.html', lineno: 7 });
      window._reportClientError('same thing', { source: 'index.html', lineno: 7 });
    });
    await expect.poll(() => calls.length, { timeout: 5000 }).toBe(1);
  });

  test('a failing alert call never breaks the page', async ({ page }) => {
    const calls = [];
    await boot(page, calls);
    await page.unroute('**/api/error-alert');
    await page.route('**/api/error-alert', (route) => route.abort());
    await page.evaluate(() => window._reportClientError('offline case', { source: 'index.html', lineno: 1 }));
    // the write still happened, and nothing threw out of the handler
    expect(await page.evaluate(() => window.__pushed.value.message)).toBe('offline case');
    expect(await page.evaluate(() => typeof render === 'function')).toBe(true);
  });
});
