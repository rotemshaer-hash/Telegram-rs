const { test, expect } = require('@playwright/test');

// Child-safety round 1.11.2026: a teacher may only write where the child started the
// conversation, the child can block, report buttons exist on other people's content,
// and approve/reject look and sit the same on every screen.
test('chat starters, block, report buttons and approve/reject', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof markChatStarter === 'function' && typeof blockUserForMe === 'function');
  const r = await page.evaluate(async () => {
    const writes = [];
    db = { ref: (p) => ({ set: async (v) => { writes.push(['set', p, v]); }, remove: async () => { writes.push(['remove', p]); }, get: async () => ({ exists: () => false, val: () => null, forEach: () => {} }) }) };
    currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true };
    currentUserData = { name: 'ילד', role: 'student', verified: true };
    await markChatStarter('teach');
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    currentUser = { uid: 'teach', email: 't@example.com', emailVerified: true };
    await markChatStarter('kid');
    const kidWrites = writes.slice();

    // block: confirm auto-accepted
    window._confirm = async () => true;
    currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true };
    currentUserData = { name: 'ילד', role: 'student', verified: true };
    writes.length = 0;
    await blockUserForMe('teach', 'מורה');

    // report buttons: other people's content only
    const others = reportBtnHtml('post', 'teach', 'מורה');
    const mine = reportBtnHtml('post', 'kid', 'ילד');
    const hostile = reportBtnHtml('post', "x');alert(1);('", 'a');

    // approve/reject share a class and approve comes first on the teacher's home
    teacherPendingBookings = [{ id: 'b1', studentId: 's1', studentName: 'דנה', status: 'pending', price: 50, day: 'א', time: '10:00', createdAt: 1 }];
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    go('home'); await new Promise((res) => setTimeout(res, 300));
    const btns = [...document.querySelectorAll('#app .act-btn')].map((b) => b.className.includes('act-ok') ? 'ok' : 'no');
    const okBtn = document.querySelector('#app .act-ok');
    return { kidWrites, blockWrites: writes, others, mine, hostile, btns, okH: okBtn ? okBtn.getBoundingClientRect().height : 0 };
  });
  expect(r.kidWrites).toEqual([['set', 'chatStarters/kid/teach', true]]); // the teacher wrote nothing
  expect(r.blockWrites.map((w) => w.join(' '))).toEqual(['set userBlockedUsers/kid/teach true', 'remove userChats/kid/teach']);
  expect(r.others).toContain('showReportDialog');
  expect(r.mine).toBe('');
  expect(r.hostile).not.toContain("alert(1);('");
  expect(r.btns.slice(0, 2)).toEqual(['ok', 'no']);
  expect(r.okH).toBeGreaterThanOrEqual(44);
});

test('a name inside a confirm or report dialog is text, never markup', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _confirm === 'function' && typeof showReportDialog === 'function');
  const r = await page.evaluate(async () => {
    window.__p = 0;
    currentUser = { uid: 'kid', email: 'k@example.com', emailVerified: true };
    const evil = '<img src=x onerror="window.__p++">';
    _confirm('לחסום את ' + evil + '?');
    showReportDialog('chatUser', 'teach', evil);
    await new Promise((res) => setTimeout(res, 300));
    return { p: window.__p, imgs: document.querySelectorAll('img[src="x"]').length, closeH: document.querySelector('._repDlg button[aria-label="סגור"]')?.getBoundingClientRect().height || 0 };
  });
  expect(r.p).toBe(0);
  expect(r.imgs).toBe(0);
  expect(r.closeH).toBeGreaterThanOrEqual(44);
});
