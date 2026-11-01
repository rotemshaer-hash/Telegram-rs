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
