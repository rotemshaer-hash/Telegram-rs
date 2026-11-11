const { test, expect } = require('@playwright/test');

// 11.11.2026 round, after the child-safety and bug-hunt reviews of the group feature:
//  * the member counter lived only in the leader's browser, so a child who left never
//    freed the place and a group that filled up stayed 'full' and vanished for good;
//  * the approve button stayed clickable through five serial network calls;
//  * an approved group could not be stopped by the admin at all, and its members were
//    told nothing when it was closed.

test('leaving a group goes through the server, which recounts the places', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof leaveGroup === 'function');
  const r = await page.evaluate(async () => {
    const calls = [];
    window.fetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, left: true, membersCount: 4, status: 'open' }) };
    };
    currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true, getIdToken: async () => 'tok' };
    currentUserData = { name: 'ילד', role: 'student', verified: true };
    communityGroups = [{ id: 'g1', status: 'full', subject: 'chess', title: 'חוג', location: 'פארק', day: 'ב', time: '17:00', maxStudents: 5, membersCount: 5, teacherId: 't1', teacherName: 'מורה', createdAt: 1 }];
    myGroupStatuses = { g1: { status: 'approved' } };
    db = { ref: () => ({ remove: async () => { throw new Error('the client must not write the group record'); } }) };
    await leaveGroup('g1');
    return { calls, local: { ...communityGroups[0] }, left: !myGroupStatuses.g1 };
  });
  expect(r.calls).toHaveLength(1);
  expect(r.calls[0].url).toContain('/api/group-leave');
  expect(r.calls[0].body).toEqual({ idToken: 'tok', groupId: 'g1' });
  expect(r.local.membersCount).toBe(4);
  expect(r.local.status).toBe('open');
  expect(r.left).toBe(true);
});

// A child must be able to walk out of a physical meetup even when the server cannot be
// reached; the counter catches up on the next leave or approval.
test('if the server cannot be reached the child still leaves', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof leaveGroup === 'function');
  const r = await page.evaluate(async () => {
    const removed = [];
    window.fetch = async () => { throw new Error('offline'); };
    db = { ref: (p) => ({ remove: async () => { removed.push(p); } }) };
    currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true, getIdToken: async () => 'tok' };
    currentUserData = { name: 'ילד', role: 'student', verified: true };
    communityGroups = [{ id: 'g1', status: 'open', title: 'חוג', teacherId: 't1', membersCount: 3, maxStudents: 5 }];
    myGroupStatuses = { g1: { status: 'approved' } };
    await leaveGroup('g1');
    return { removed, left: !myGroupStatuses.g1 };
  });
  expect(r.removed).toEqual(['groupMembers/g1/kid', 'userGroups/kid/g1']);
  expect(r.left).toBe(true);
});

test('a double click on "approve" counts one child, and the leader cannot pass the group size', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _approveGroupMember === 'function');
  const r = await page.evaluate(async () => {
    const counts = [];
    const server = { 'groups/g1': { teacherId: 'teach', title: 'חוג', maxStudents: 3, membersCount: 2, status: 'open' } };
    db = { ref: (p) => ({
      get: async () => ({ exists: () => p in server, val: () => server[p], forEach: () => {} }),
      set: async (v) => { if (p === 'groups/g1/membersCount') { counts.push(v); server['groups/g1'].membersCount = v; } },
      push: async () => {}, remove: async () => {}, update: async () => {},
      child: (c) => db.ref(p + '/' + c),
    }) };
    window.notifyUser = async () => {};
    window.groupMail = () => {};
    currentUser = { uid: 'teach', email: 't@example.com', emailVerified: true };
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    communityGroups = [{ id: 'g1', status: 'open', maxStudents: 3, membersCount: 2, teacherId: 'teach' }];
    const wrap = document.createElement('div');
    wrap.innerHTML = '<button>✓ אשר</button><button>✗ דחה</button>';
    document.body.appendChild(wrap);
    // two clicks, the second while the first is still in flight
    await Promise.all([_approveGroupMember('g1', 'kid', wrap), _approveGroupMember('g1', 'kid', wrap)]);
    const afterFirst = [...counts];
    // the group is full now — one more approval must be refused
    await _approveGroupMember('g1', 'kid2', null);
    return { afterFirst, counts, status: server['groups/g1'].membersCount };
  });
  expect(r.afterFirst).toEqual([3]);
  expect(r.counts).toEqual([3]);
  expect(r.status).toBe(3);
});

test('the admin can suspend a published group, and everyone in it is told', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof adminSuspendGroup === 'function');
  const r = await page.evaluate(async () => {
    const writes = [], pushed = [];
    const members = { kid1: { status: 'approved', name: 'א' }, kid2: { status: 'pending', name: 'ב' }, kid3: { status: 'rejected', name: 'ג' } };
    db = { ref: (p) => ({
      get: async () => ({ exists: () => p === 'groupMembers/g1', val: () => members, forEach: (cb) => Object.entries(members).forEach(([k, v]) => cb({ key: k, val: () => v })) }),
      set: async (v) => { writes.push([p, v]); },
      push: async (v) => { pushed.push([p, v]); },
    }) };
    window._confirm = async () => true;
    currentUser = { uid: 'admin', email: 'rotemshaer@gmail.com', emailVerified: true };
    currentUserData = { name: 'מנהל', role: 'teacher', verified: true };
    adminOpenGroups = [{ id: 'g1', status: 'open', title: 'חוג', teacherId: 'teach', teacherName: 'מורה', location: 'פארק', membersCount: 2, maxStudents: 5 }];
    communityGroups = [{ id: 'g1', status: 'open', title: 'חוג', teacherId: 'teach' }];
    await adminSuspendGroup('g1');
    return {
      writes,
      told: pushed.map((x) => x[0]).sort(),
      types: [...new Set(pushed.map((x) => x[1].type))],
      stillListed: adminOpenGroups.length + communityGroups.length,
    };
  });
  expect(r.writes).toEqual([['groups/g1/status', 'cancelled']]);
  // the leader and both children who were not rejected
  expect(r.told).toEqual(['notifications/kid1', 'notifications/kid2', 'notifications/teach']);
  expect(r.types).toEqual(['groupSuspended']);
  expect(r.stillListed).toBe(0);
});
