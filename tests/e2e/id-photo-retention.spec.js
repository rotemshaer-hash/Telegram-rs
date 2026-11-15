const { test, expect } = require('@playwright/test');

// 15.11.2026 — ID photos used to stay until the account was deleted. The deletion runs on the server
// (netlify/functions/id-photo-purge.js); what the browser must do is record WHEN, at each of the four decisions
// the owner makes. These tests drive the real handlers and read what they write.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof scheduleIdPurge === 'function' && typeof adminVerifyStudent === 'function' && typeof adminApproveTeacher === 'function');
}

// returns the values written, keyed by path
async function decide(page, handler, uid, vals) {
  return page.evaluate(async ({ handler, uid, vals }) => {
    const writes = {};
    window.showFireToast = () => {};
    window._confirm = async () => true;
    db = { ref: (p) => ({
      get: () => Promise.resolve({ val: () => vals[p] ?? null, exists: () => vals[p] !== undefined }),
      set: (v) => { writes[p] = v; return Promise.resolve(); },
      update: (v) => { writes[p] = v; return Promise.resolve(); },
      push: () => Promise.resolve(), remove: () => Promise.resolve(),
    }) };
    window.sendAdminEmail = () => {}; window.loadAdminData = () => Promise.resolve(); window.renderAdminPanel = () => {};
    const t0 = Date.now();
    await window[handler](uid);
    return { writes, t0, retentionDays: ID_PHOTO_RETENTION_DAYS };
  }, { handler, uid, vals });
}
const dueInDays = (r, uid) => (r.writes['idPurgeDue/' + uid] - r.t0) / 86400000;

test.describe('every decision schedules the deletion of the ID photos', () => {
  test('approving a student', async ({ page }) => {
    await boot(page);
    const r = await decide(page, 'adminVerifyStudent', 's1', { 'users/s1/parentConsentAt': 1, 'users/s1': { name: 'ילד', role: 'student' } });
    expect(r.retentionDays).toBe(30);
    expect(dueInDays(r, 's1')).toBeGreaterThan(29.99);
    expect(dueInDays(r, 's1')).toBeLessThan(30.01);
  });

  test('rejecting a student also stamps when', async ({ page }) => {
    await boot(page);
    const r = await decide(page, 'adminRejectStudent', 's1', {});
    expect(dueInDays(r, 's1')).toBeGreaterThan(29.99);
    expect(typeof r.writes['users/s1/rejectedAt']).toBe('number');
  });

  test('approving a teacher', async ({ page }) => {
    await boot(page);
    const r = await decide(page, 'adminApproveTeacher', 't1', {
      'teachers/t1/ageVerification/status': 'verified', 'users/t1/parentConsentAt': 1, 'users/t1/role': 'teacher',
    });
    expect(dueInDays(r, 't1')).toBeGreaterThan(29.99);
  });

  test('rejecting a teacher also stamps when', async ({ page }) => {
    await boot(page);
    const r = await decide(page, 'adminRejectTeacher', 't1', {});
    expect(dueInDays(r, 't1')).toBeGreaterThan(29.99);
    expect(typeof r.writes['users/t1/rejectedAt']).toBe('number');
  });

  test('a refused approval (no parent consent yet) schedules nothing — the photo is still needed', async ({ page }) => {
    await boot(page);
    const r = await decide(page, 'adminVerifyStudent', 's1', { 'users/s1/parentConsentAt': null, 'users/s1': { name: 'ילד', role: 'student' } });
    expect(r.writes['idPurgeDue/s1']).toBeUndefined();
  });

  test('if the scheduling write fails, the admin is told rather than left believing it was set', async ({ page }) => {
    await boot(page);
    const toasts = await page.evaluate(async () => {
      const t = [];
      window.showFireToast = (m) => t.push(String(m));
      db = { ref: () => ({ set: () => Promise.reject(new Error('denied')) }) };
      await scheduleIdPurge('s1');
      return t;
    });
    expect(toasts.join(' ')).toContain('מחיקת התעודה לא תוזמנה');
  });
});
