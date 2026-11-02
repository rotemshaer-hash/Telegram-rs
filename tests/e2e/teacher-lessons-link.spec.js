const { test, expect } = require('@playwright/test');

// QA 1.11.2026: (1) a teacher's "my lessons" read only the pending list, so approved and completed
// lessons showed as ₪0 / 0 lessons; (2) a meeting link the rules would reject (no https://, a quote,
// over 600 chars) made EVERY approval fail with PERMISSION_DENIED; (3) a free trial showed "₪0".
test('my lessons shows the teacher’s real lessons, and only a valid meeting link is used', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof showPaymentManagement === 'function' && typeof meetingLinkClean === 'function');
  const r = await page.evaluate(async () => {
    currentUser = { uid: 't1', email: 't@example.com', emailVerified: true };
    currentUserData = { name: 'מורה', role: 'teacher', verified: true };
    teacherPendingBookings = [];
    teacherAllBookings = [
      { id: 'a', studentName: 'דנה', status: 'approved', price: 60, createdAt: 3 },
      { id: 'b', studentName: 'רן', status: 'completed', price: 40, createdAt: 2 },
      { id: 'c', studentName: 'נועה', status: 'cancelled', price: 50, createdAt: 1 },
    ];
    showPaymentManagement();
    await new Promise((res) => setTimeout(res, 200));
    return {
      text: document.body.innerText,
      order: teacherAllBookings.map((b) => b.id).join(''),
      links: [meetingLinkClean('https://zoom.us/j/1'), meetingLinkClean('zoom.us/j/1'), meetingLinkClean("https://a.b/x'y"), meetingLinkClean('https://' + 'a'.repeat(700)), meetingLinkClean('https://evil.example/x'), meetingLinkClean('https://us02web.zoom.us/j/1'), meetingLinkClean('http://zoom.us/j/1')],
    };
  });
  expect(r.text).toContain('₪100');
  expect(r.text).toContain('דנה');
  expect(r.text).toContain('בוטל');
  expect(r.order).toBe('abc'); // the screen sorts a copy, not the shared list
  expect(r.links).toEqual(['https://zoom.us/j/1', '', '', '', '', 'https://us02web.zoom.us/j/1', '']);
});
