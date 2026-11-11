const { test, expect } = require('@playwright/test');

// 11.11.2026 round, after the child-safety and bug-hunt reviews of the group feature:
//  * the member counter lived only in the leader's browser, so a child who left never
//    freed the place and a group that filled up stayed 'full' and vanished for good;
//  * the approve button stayed clickable through five serial network calls;
//  * an approved group could not be stopped by the admin at all, and its members were
//    told nothing when it was closed.

test('leaving an approved membership frees the place on the server and reopens a full group', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof leaveGroup === 'function');
  const r = await page.evaluate(async () => {
    const writes = [], removed = [];
    const server = { 'groups/g1/membersCount': 5, 'groups/g1/status': 'full' };
    db = { ref: (p) => ({
      get: async () => ({ exists: () => p in server, val: () => server[p], forEach: () => {} }),
      set: async (v) => { writes.push([p, v]); server[p] = v; },
      remove: async () => { removed.push(p); },
      child: (c) => db.ref(p + '/' + c),
    }) };
    currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true };
    currentUserData = { name: 'ילד', role: 'student', verified: true };
    communityGroups = [{ id: 'g1', status: 'full', subject: 'chess', title: 'חוג', location: 'פארק', day: 'ב', time: '17:00', maxStudents: 5, membersCount: 5, teacherId: 't1', teacherName: 'מורה', createdAt: 1 }];
    myGroupStatuses = { g1: { status: 'approved' } };
    await leaveGroup('g1');
    const afterApproved = { writes: [...writes], removed: [...removed], local: { ...communityGroups[0] } };

    writes.length = 0; removed.length = 0;
    myGroupStatuses = { g1: { status: 'pending' } };
    await leaveGroup('g1');
    return { afterApproved, pendingWrites: writes };
  });
  expect(r.afterApproved.writes).toEqual([['groups/g1/membersCount', 4], ['groups/g1/status', 'open']]);
  expect(r.afterApproved.removed).toEqual(['groupMembers/g1/kid', 'userGroups/kid/g1']);
  expect(r.afterApproved.local.membersCount).toBe(4);
  expect(r.afterApproved.local.status).toBe('open');
  // a request that was never approved held no place, so it must not free one
  expect(r.pendingWrites).toEqual([]);
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
