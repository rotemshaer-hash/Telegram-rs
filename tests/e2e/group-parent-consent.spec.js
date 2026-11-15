const { test, expect } = require('@playwright/test');

// 15.11.2026 — the legal gaps list in LEGAL-EVIDENCE.md: "the parent approved the app, never the group"
// and "no age range per group". These tests drive the real screens: what a child can do, what the
// leader sees, and the page a parent lands on from the email.

async function boot(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof joinGroup === 'function' && typeof _loadGroupConsentInfo === 'function');
}

const GROUP = { id: 'g1', status: 'open', subject: 'chess', title: 'חוג שחמט', desc: 'x', location: 'פארק הירקון', day: 'יום ב', time: '17:00', maxStudents: 5, membersCount: 1, teacherId: 't1', teacherName: 'מורה', createdAt: 1, minAge: 11, maxAge: 14 };

test.describe('a child joins only through the parent', () => {
  test('joining writes the pending request and then asks the server to mail the parent', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async (GROUP) => {
      const writes = []; const calls = [];
      db = { ref: (p) => ({ get: async () => ({ exists: () => false }), set: async (v) => { writes.push([p, v]); }, remove: async () => { writes.push([p, 'REMOVED']); } }) };
      window.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, sent: true }) }; };
      window.notifyUser = async () => {};
      currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true, getIdToken: async () => 'tok' };
      currentUserData = { name: 'דנה', role: 'student', verified: true, age: 12 };
      communityGroups = [GROUP]; myGroupStatuses = {};
      await joinGroup('g1');
      return { writes: writes.map((w) => w[0]), calls, status: myGroupStatuses.g1 && myGroupStatuses.g1.status };
    }, GROUP);
    expect(r.writes[0]).toBe('groupMembers/g1/kid');
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toContain('/api/group-consent');
    expect(r.calls[0].body).toEqual({ action: 'request', idToken: 'tok', groupId: 'g1' });
    expect(r.status).toBe('pending');
  });

  test('a child outside the age range cannot ask: nothing is written, nobody is mailed', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async (GROUP) => {
      const writes = []; let fetched = 0;
      db = { ref: (p) => ({ get: async () => ({ exists: () => false }), set: async (v) => { writes.push(p); } }) };
      window.fetch = async () => { fetched++; return { ok: true, status: 200, json: async () => ({}) }; };
      currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true, getIdToken: async () => 'tok' };
      currentUserData = { name: 'דנה', role: 'student', verified: true, age: 9 };
      communityGroups = [GROUP]; myGroupStatuses = {};
      await joinGroup('g1');
      showGroupDetail('g1');
      return { writes, fetched, screen: document.getElementById('_gdOv').innerText };
    }, GROUP);
    expect(r.writes).toEqual([]);
    expect(r.fetched).toBe(0);
    expect(r.screen).toContain('הקבוצה מיועדת לגילאים 11–14');
    expect(r.screen).not.toContain('הצטרף לקבוצה');
  });

  test('a child with no parent address on file is not left as a pending row nobody can approve', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async (GROUP) => {
      const writes = [];
      db = { ref: (p) => ({ get: async () => ({ exists: () => false }), set: async () => { writes.push(['set', p]); }, remove: async () => { writes.push(['remove', p]); } }) };
      window.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: 'no_parent_email' }) });
      window.notifyUser = async () => { writes.push(['notify']); };
      currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true, getIdToken: async () => 'tok' };
      currentUserData = { name: 'דנה', role: 'student', verified: true, age: 12 };
      communityGroups = [GROUP]; myGroupStatuses = {};
      await joinGroup('g1');
      return { writes, left: !myGroupStatuses.g1 };
    }, GROUP);
    expect(r.writes.filter((w) => w[0] === 'remove').map((w) => w[1])).toEqual(['groupMembers/g1/kid', 'userGroups/kid/g1']);
    expect(r.writes.some((w) => w[0] === 'notify')).toBe(false);   // the leader is not told about a request that cannot go on
    expect(r.left).toBe(true);
  });

  test('while the parent has not answered, the child sees whose turn it is and can resend', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async (GROUP) => {
      currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true };
      currentUserData = { name: 'דנה', role: 'student', verified: true, age: 12 };
      communityGroups = [GROUP];
      myGroupStatuses = { g1: { status: 'pending' } };
      showGroupDetail('g1');
      const waiting = document.getElementById('_gdOv').innerText;
      document.getElementById('_gdOv').remove();
      myGroupStatuses = { g1: { status: 'pending', parentApprovedAt: 5 } };
      showGroupDetail('g1');
      return { waiting, approved: document.getElementById('_gdOv').innerText };
    }, GROUP);
    expect(r.waiting).toContain('ממתין לאישור ההורה');
    expect(r.waiting).toContain('שלח שוב את המייל להורה');
    expect(r.approved).toContain('ההורה אישר');
    expect(r.approved).not.toContain('שלח שוב את המייל להורה');
  });
});

test.describe('the leader cannot approve a child whose parent has not', () => {
  test('the panel shows "waiting for the parent" instead of an approve button', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async (GROUP) => {
      const members = { waiting: { name: 'ממתין', status: 'pending', joinedAt: 1 }, ready: { name: 'מוכן', status: 'pending', joinedAt: 2, parentApprovedAt: 9 } };
      db = { ref: (p) => ({ get: async () => ({ exists: () => p === 'groupMembers/g1', forEach: (cb) => Object.entries(members).forEach(([k, v]) => cb({ key: k, val: () => v })) }) }) };
      currentUser = { uid: 't1', email: 't@example.com', emailVerified: true };
      currentUserData = { name: 'מורה', role: 'teacher', verified: true };
      communityGroups = [GROUP];
      await showTeacherGroupsPanel();
      const rows = [...document.querySelectorAll('#_tgOv span')].filter((s) => s.textContent === 'ממתין' || s.textContent === 'מוכן').map((s) => s.parentElement);
      return rows.map((row) => ({ approve: !!row.querySelector('.act-ok'), text: row.innerText }));
    }, GROUP);
    expect(r[0].approve).toBe(false);
    expect(r[0].text).toContain('ממתין לאישור ההורה');
    expect(r[1].approve).toBe(true);
  });

  test('the approve action itself refuses, and writes nothing', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(async () => {
      const writes = [];
      const server = { 'groups/g1': { teacherId: 't1', maxStudents: 5, membersCount: 0, status: 'open' }, 'groupMembers/g1/kid': { status: 'pending' } };
      db = { ref: (p) => ({ get: async () => ({ val: () => server[p], exists: () => p in server }), set: async () => { writes.push(p); } }) };
      window.notifyUser = async () => {}; window.groupMail = () => {};
      currentUser = { uid: 't1', email: 't@example.com', emailVerified: true };
      await _approveGroupMember('g1', 'kid', null);
      return writes;
    });
    expect(r).toEqual([]);
  });
});

test.describe('the page a parent lands on from the email', () => {
  const INFO = { childName: 'דנה', status: 'pending', emergencyPhone: '0542020812',
    group: { title: 'חוג שחמט', teacherName: 'מורה', location: 'פארק הירקון', day: 'יום ב', time: '17:00', minAge: 11, maxAge: 14 } };

  async function openLink(page, info, onCall) {
    await page.route('**/api/group-consent', async (route) => {
      const b = route.request().postDataJSON();
      onCall && onCall(b);
      if (b.action === 'info') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(info) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, decision: b.action === 'approve' ? 'approved' : 'declined', childName: info.childName }) });
    });
    await page.goto('/?groupConsent=' + 'a'.repeat(64), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#_gcOk', { timeout: 8000 });
  }

  test('shows the group, the age range, the physical-meetup notice and the emergency number', async ({ page }) => {
    await openLink(page, INFO);
    const txt = await page.locator('#_pcContent').innerText();
    for (const part of ['דנה', 'חוג שחמט', 'פארק הירקון', 'יום ב בשעה 17:00', 'גילאים 11–14', 'ללא נוכחות הורים', '0542020812', 'משטרה 100']) {
      expect(txt, part).toContain(part);
    }
    await expect(page.locator('#_pcContent a[href="tel:0542020812"]')).toHaveCount(1);
  });

  test('approve sends the token and the decision, and confirms to the parent', async ({ page }) => {
    const calls = [];
    await openLink(page, INFO, (b) => calls.push(b));
    await page.click('#_gcOk');
    await expect(page.locator('#_pcContent')).toContainText('האישור נרשם');
    expect(calls.map((c) => c.action)).toEqual(['info', 'approve']);
    expect(calls[1].token).toBe('a'.repeat(64));
  });

  test('"I do not approve" is a real answer, not just closing the tab', async ({ page }) => {
    const calls = [];
    await openLink(page, INFO, (b) => calls.push(b));
    await page.click('#_gcNo');
    await expect(page.locator('#_pcContent')).toContainText('הבקשה נדחתה');
    expect(calls.map((c) => c.action)).toEqual(['info', 'decline']);
  });

  test('a hostile group title is shown as text, not run', async ({ page }) => {
    await openLink(page, { ...INFO, group: { ...INFO.group, title: '<img src=x onerror="window.__gcxss=1">' } });
    expect(await page.evaluate(() => window.__gcxss)).toBeUndefined();
    expect(await page.locator('#_pcContent img[src="x"]').count()).toBe(0);
  });

  test('an answer already given is shown as given, with no buttons', async ({ page }) => {
    await page.route('**/api/group-consent', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...INFO, status: 'approved' }) }));
    await page.goto('/?groupConsent=' + 'b'.repeat(64), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#_pcContent')).toContainText('כבר אישרת');
    await expect(page.locator('#_gcOk')).toHaveCount(0);
  });
});

test.describe('a new group must declare an age range', () => {
  async function saveWith(page, min, max) {
    return page.evaluate(async ({ min, max }) => {
      const writes = [];
      db = { ref: (p) => ({ push: () => ({ key: 'g1', set: async (v) => { writes.push(v); } }), set: async () => {}, update: async () => {} }) };
      window.notifyAdmin = async () => {};
      currentUser = { uid: 'teach', email: 't@example.com', emailVerified: true };
      currentUserData = { name: 'מורה', role: 'teacher', verified: true, age: 15 };
      document.body.insertAdjacentHTML('beforeend', `<input id="_cgTitle" value="שחמט"><input id="_cgLocation" value="הרצל 15, תל אביב"><input id="_cgDesc" value="כיף"><select id="_cgCat"><option value="x" selected>x</option></select><select id="_cgMinAge"><option value="${min}" selected>${min}</option></select><select id="_cgMaxAge"><option value="${max}" selected>${max}</option></select>`);
      await _saveNewGroup();
      return writes;
    }, { min, max });
  }

  test('the range is written with the group', async ({ page }) => {
    await boot(page);
    const w = await saveWith(page, 12, 14);
    expect(w).toHaveLength(1);
    expect(w[0].minAge).toBe(12);
    expect(w[0].maxAge).toBe(14);
  });

  test('a range that runs backwards, or no range, is not saved', async ({ page }) => {
    await boot(page);
    expect(await saveWith(page, 15, 12)).toEqual([]);
    await page.evaluate(() => document.querySelectorAll('input[id^="_cg"],select[id^="_cg"]').forEach((e) => e.remove()));
    expect(await saveWith(page, '', '')).toEqual([]);
  });

  test('a leader cannot aim a group at children more than 3 years younger — the form and the save agree', async ({ page }) => {
    await boot(page);
    expect(await saveWith(page, 11, 14)).toEqual([]);          // a 15-year-old, minimum 11: refused before any write
    const r = await page.evaluate(() => {
      currentUser = { uid: 'teach', email: 't@example.com', emailVerified: true };
      TEACHERS.push({ id: 'teach', name: 'מורה', cats: ['chess'], city: 'תל אביב' });
      const out = {};
      for (const age of [14, 15, 18]) {
        currentUserData = { name: 'מורה', role: 'teacher', verified: true, categories: ['chess'], age };
        document.getElementById('_cgOv')?.remove();
        document.querySelectorAll('body > input[id^="_cg"], body > select[id^="_cg"]').forEach((e) => e.remove());
        showCreateGroupDialog();
        const min = document.getElementById('_cgMinAge'), max = document.getElementById('_cgMaxAge');
        out[age] = { minDefault: min.value, maxDefault: max.value, first: min.options[1].value, last: min.options[min.options.length - 1].value, maxFirst: max.options[1].value };
      }
      return out;
    });
    expect(r[14]).toEqual({ minDefault: '', maxDefault: '', first: '11', last: '18', maxFirst: '9' });
    expect(r[15].first).toBe('12');
    expect(r[18].first).toBe('15');
  });
});
