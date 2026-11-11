const { test, expect } = require('@playwright/test');

// Group fields come from whoever created the group. location/time/maxStudents were
// printed raw on the home screen, community and group dialogs (QA 1.11.2026): one guest
// writing groups/z1 ran script on every user's home screen.
test('a hostile group location, time and counts render as text on every screen', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Home === 'function' && typeof showWhatsAppDialog === 'function');
  const r = await page.evaluate(async () => {
    window.__pwn = 0;
    const evil = '<img src=x onerror="window.__pwn++">';
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true };
    communityGroups = [{ id: 'g1', status: 'open', subject: 'chess', title: 'חוג', desc: 'x', location: evil, day: 'ב', time: evil, maxStudents: evil, membersCount: evil, teacherId: 't1', teacherName: 'מורה', createdAt: 1 }];
    go('home'); await new Promise((res) => setTimeout(res, 300));
    S.pTab = 'groups'; go('community'); await new Promise((res) => setTimeout(res, 300));
    showWhatsAppDialog('0501234567', evil, evil); await new Promise((res) => setTimeout(res, 300));
    const cat = catById('x"><img src=x onerror="window.__pwn++">').lbl;
    return { pwn: window.__pwn, cat, color: safeColor('red;background:url(x)'), css: safeCssUrl('https://a.b/c.png") ,x') };
  });
  expect(r.pwn).toBe(0);
  expect(r.cat).not.toMatch(/[<>"]/);
  expect(r.color).toBe('#14B8A6');
  expect(r.css).toBeNull();
});

// The subject filter row above the group list is built by string concatenation, not by a
// template, so scripts/check-handler-escapes.js (which only read ${...}) did not see it
// and the value went into onclick="S.groupSubj='…'" raw. subject has no .validate before
// 4.11.77, so a leader with a hand-made client could put a quote in it and run code on
// every verified user who opened the groups tab (bug hunt 10.11.2026).
test('a hostile group subject cannot break out of the filter button handler', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Community === 'function');
  const r = await page.evaluate(async () => {
    window.__pwn = 0;
    // a payload that stays valid JS once it is pasted into onclick="S.groupSubj='…'"
    const evil = "x';window.__pwn++;S.groupSubj='y";
    currentUser = { uid: 'stu', email: 's@example.com', emailVerified: true };
    currentUserData = { name: 'תלמיד', role: 'student', verified: true };
    communityGroups = [
      { id: 'g1', status: 'open', subject: evil, title: 'חוג א', desc: 'x', location: 'פארק', day: 'ב', time: '17:00', maxStudents: 5, membersCount: 0, teacherId: 't1', teacherName: 'מורה', createdAt: 2 },
      { id: 'g2', status: 'open', subject: 'math', title: 'חוג ב', desc: 'x', location: 'פארק', day: 'ג', time: '18:00', maxStudents: 5, membersCount: 0, teacherId: 't1', teacherName: 'מורה', createdAt: 1 },
    ];
    S.comTab = 'groups'; go('community');
    await new Promise((res) => setTimeout(res, 300));
    // click every filter chip — the handler is what would run the injected code
    document.querySelectorAll('button[onclick*="S.groupSubj"]').forEach((b) => b.click());
    await new Promise((res) => setTimeout(res, 300));
    return { pwn: window.__pwn, chips: document.querySelectorAll('button[onclick*="S.groupSubj"]').length };
  });
  expect(r.chips).toBeGreaterThan(0);
  expect(r.pwn).toBe(0);
});
