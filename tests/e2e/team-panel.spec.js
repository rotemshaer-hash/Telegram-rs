const { test, expect } = require('@playwright/test');

// 15.11.2026 — "צוות Drushe" can now be several people. The rules and the server decide what a member may do; these
// tests pin what the screen shows: a member opens the panel and sees the review work, never the owner's controls, and
// the owner can add and remove members only through the server.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof showAdminPanel === 'function' && typeof isStaff === 'function');
}

async function asUser(page, { email, teamFlag }) {
  await page.evaluate(async ({ email, teamFlag }) => {
    currentUser = { uid: 'me', email, emailVerified: true, getIdToken: async () => 'tok' };
    currentUserData = { name: 'אני', role: 'teacher', verified: true };
    db = { ref: (p) => ({ get: async () => ({ val: () => (p === 'team/me' && teamFlag ? true : null), exists: () => p === 'team/me' && teamFlag, forEach: () => {} }) }) };
    await _loadTeamFlag();
  }, { email, teamFlag });
}

test.describe('who counts as staff', () => {
  test('the owner and a flagged member are staff; a flagged-off member and a stranger are not', async ({ page }) => {
    await boot(page);
    await asUser(page, { email: 'rotemshaer@gmail.com', teamFlag: false });
    expect(await page.evaluate(() => ({ owner: isAdmin(), team: isTeam(), staff: isStaff() }))).toEqual({ owner: true, team: false, staff: true });
    await asUser(page, { email: 'dana@example.org', teamFlag: true });
    expect(await page.evaluate(() => ({ owner: isAdmin(), team: isTeam(), staff: isStaff() }))).toEqual({ owner: false, team: true, staff: true });
    await asUser(page, { email: 'dana@example.org', teamFlag: false });
    expect(await page.evaluate(() => ({ owner: isAdmin(), team: isTeam(), staff: isStaff() }))).toEqual({ owner: false, team: false, staff: false });
  });

  test('a non-member opening the panel is refused before anything loads', async ({ page }) => {
    await boot(page);
    await asUser(page, { email: 'dana@example.org', teamFlag: false });
    const r = await page.evaluate(() => { const t = []; window.showFireToast = (m) => t.push(String(m)); showAdminPanel(); return { t, open: !!document.getElementById('_adminPanel') }; });
    expect(r.open).toBe(false);
    expect(r.t.join(' ')).toContain('אין הרשאת מנהל');
  });
});

test.describe('what a member sees in the panel', () => {
  async function openPanel(page, email, teamFlag) {
    await asUser(page, { email, teamFlag });
    await page.evaluate(() => {
      adminAllUsers = []; adminAllTeachers = []; adminAllVideos = []; adminAllReports = []; adminAllBookings = []; adminIncompleteTeachers = [];
      adminAlertStudents = []; adminAlertPosts = []; adminAllPosts = []; adminAllReviews = []; adminAllClientErrors = []; adminContactMessages = [];
      adminTeamList = [{ uid: 'm1', name: 'דנה', email: 'dana@example.org' }];
      window.__confirmed = 0;
      renderAdminPanel();
    });
  }
  const tabs = (page) => page.evaluate(() => [...document.querySelectorAll('#_adminPanel [onclick^="adminSwitchTab("]')].map((e) => e.getAttribute('onclick').match(/'([^']+)'/)[1]));

  test('a member gets the review tabs and none of the owner’s', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'dana@example.org', true);
    const t = await tabs(page);
    for (const need of ['teachers', 'students', 'reports', 'groups', 'posts', 'videos', 'reviews', 'stories', 'users', 'errors']) expect(t, need).toContain(need);
    for (const hidden of ['bookings', 'subscriptions', 'messages', 'stats', 'team']) expect(t, hidden).not.toContain(hidden);
  });

  test('the owner gets every tab, including the team', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'rotemshaer@gmail.com', false);
    const t = await tabs(page);
    for (const need of ['bookings', 'subscriptions', 'messages', 'stats', 'team', 'errors']) expect(t, need).toContain(need);
  });

  test('buttons for owner-only actions are not offered to a member, and are to the owner', async ({ page }) => {
    await boot(page);
    for (const [email, flag, expectPresent] of [['dana@example.org', true, false], ['rotemshaer@gmail.com', false, true]]) {
      await asUser(page, { email, teamFlag: flag });
      const present = await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = '_adminPanel';
        host.innerHTML = '<button onclick="adminDeleteUser(\'u\',\'n\',\'student\')">delete</button><button onclick="resetSystem()">reset</button><button onclick="adminVerifyStudent(\'u\')">approve</button>';
        _adminHideOwnerOnly(host);
        return { del: !!host.querySelector('[onclick^="adminDeleteUser"]'), reset: !!host.querySelector('[onclick^="resetSystem"]'), approve: !!host.querySelector('[onclick^="adminVerifyStudent"]') };
      });
      expect(present.approve, 'approving stays for everyone on staff').toBe(true);
      expect(present.del).toBe(expectPresent);
      expect(present.reset).toBe(expectPresent);
    }
  });

  test('a member skips the owner’s PIN — it protects the owner’s configuration, which a member cannot read', async ({ page }) => {
    await boot(page);
    await asUser(page, { email: 'dana@example.org', teamFlag: true });
    const ran = await page.evaluate(async () => { let ok = false; await _verifyAdminPin(() => { ok = true; }); return ok && !document.getElementById('_adminPinInput'); });
    expect(ran).toBe(true);
  });
});

test.describe('the owner manages the team through the server', () => {
  async function ownerWithTeamTab(page) {
    await asUser(page, { email: 'rotemshaer@gmail.com', teamFlag: false });
    await page.evaluate(() => {
      adminAllUsers = []; adminAllTeachers = []; adminAllVideos = []; adminAllReports = []; adminAllBookings = []; adminIncompleteTeachers = [];
      adminAlertStudents = []; adminAlertPosts = []; adminAllPosts = []; adminAllReviews = []; adminAllClientErrors = []; adminContactMessages = [];
      adminTeamList = [{ uid: 'm1', name: 'דנה', email: 'dana@example.org' }];
      adminTab = 'team';
      window._confirm = async () => true;
      window.__calls = [];
      window.fetch = async (url, o) => { const b = JSON.parse(o.body); window.__calls.push({ url, b }); return { ok: true, status: 200, json: async () => (b.action === 'list' ? { members: [] } : { ok: true, created: true }) }; };
      renderAdminPanel();
    });
  }

  test('adding needs the "this is an adult" box and sends exactly the email', async ({ page }) => {
    await boot(page);
    await ownerWithTeamTab(page);
    await page.fill('#_teamEmail', 'new@example.org');
    await page.click('button:has-text("הוסף לצוות")');
    expect(await page.evaluate(() => window.__calls.filter((c) => c.b.action === 'add'))).toEqual([]);
    await page.check('#_teamAdult');
    await page.click('button:has-text("הוסף לצוות")');
    await expect.poll(() => page.evaluate(() => window.__calls.filter((c) => c.b.action === 'add').length)).toBe(1);
    const call = await page.evaluate(() => window.__calls.find((c) => c.b.action === 'add'));
    expect(call.url).toContain('/api/team-roles');
    expect(call.b).toEqual({ idToken: 'tok', action: 'add', email: 'new@example.org', confirmAdult: true });
  });

  test('removing sends the uid', async ({ page }) => {
    await boot(page);
    await ownerWithTeamTab(page);
    await page.click('button:has-text("הסר")');
    await expect.poll(() => page.evaluate(() => window.__calls.some((c) => c.b.action === 'remove'))).toBe(true);
    expect((await page.evaluate(() => window.__calls.find((c) => c.b.action === 'remove'))).b.uid).toBe('m1');
  });

  test('the team tab is not even built for a member', async ({ page }) => {
    await boot(page);
    await asUser(page, { email: 'dana@example.org', teamFlag: true });
    const html = await page.evaluate(() => { adminTab = 'team'; adminTeamList = [{ uid: 'm1', name: 'x', email: 'x@y.z' }]; return renderAdminTab(); });
    expect(html).not.toContain('_teamEmail');
  });
});
