const { test, expect } = require('@playwright/test');

// Guards deleteAllUserData against the class of bug that shipped three times:
// deletion code that looks correct but never reaches the data, so the account
// "deletes successfully" while a minor's name, their parent's email or their
// ID photo stay in the database.
//
// Two distinct failure modes are covered here.
//
// 1. WRONG FIELD NAME. The field names asserted below are the ones the app
//    actually writes:
//      reviews / pendingReviews -> author is `from`     (NOT `uid`)
//      communityPosts           -> author is `authUid`  (NOT `uid`)
//      bookings                 -> studentId / teacherId
//
// 2. NO READ PERMISSION. database.rules.json grants a read on `bookings` only
//    at bookings/<id> (and at the root, for the admin), and `pendingReviews`
//    is admin-read-only. A user deleting their own account therefore CANNOT
//    scan either node — the request is denied, the denial is swallowed, and
//    nothing is deleted. The stub below reproduces that by refusing those two
//    reads, so a fix that depends on scanning them fails here instead of on a
//    real device. Every booking mirror still has to be gone.
//
// db is a plain `var` in index.html, so the real shipped deleteAllUserData is
// exercised against a seeded in-memory store — not a reimplementation.

const VICTIM = 'victim-uid';
const KEEP = 'other-uid';
const TEACHER = 'teacher-uid';

// Reads a user deleting their own account is not permitted to make.
const DENIED_TO_SELF = ['bookings', 'pendingReviews'];

async function runDeletion(page, role, { asAdmin = false } = {}) {
  return page.evaluate(async ({ VICTIM, KEEP, TEACHER, role, asAdmin, DENIED_TO_SELF }) => {
    const booking = (student, teacher, name) => ({
      studentId: student, teacherId: teacher, studentName: name,
      studentEmail: name + '@example.com', parentEmail: 'parent-of-' + name + '@example.com',
    });

    const store = {
      reviews: {
        'teacher-A': {
          r1: { from: VICTIM, fromName: 'Victim', review: 'bad', stars: 1 },
          r2: { from: KEEP, fromName: 'Other', review: 'good', stars: 5 },
        },
        'teacher-B': { r3: { from: VICTIM, fromName: 'Victim', stars: 3 } },
      },
      // Keyed by reviewId, the way submitReview writes it — that is what lets
      // a user who cannot read this node still delete their own entry.
      pendingReviews: {
        r1: { from: VICTIM, fromName: 'Victim', reviewId: 'r1' },
        r3: { from: VICTIM, fromName: 'Victim', reviewId: 'r3' },
        r2: { from: KEEP, fromName: 'Other', reviewId: 'r2' },
      },
      communityPosts: {
        c1: { authUid: VICTIM, author: 'Victim', text: 'hello' },
        c2: { authUid: KEEP, author: 'Other', text: 'hi' },
      },
      // Three mirrors of the same booking, exactly as openBooking() writes them.
      bookings: {
        b1: booking(VICTIM, TEACHER, 'Victim'),
        b2: booking(KEEP, TEACHER, 'Other'),
      },
      userBookings: {
        [VICTIM]: { b1: booking(VICTIM, TEACHER, 'Victim') },
        [KEEP]: { b2: booking(KEEP, TEACHER, 'Other') },
      },
      teacherBookings: {
        [TEACHER]: { b1: booking(VICTIM, TEACHER, 'Victim'), b2: booking(KEEP, TEACHER, 'Other') },
      },
      users: { [VICTIM]: { name: 'Victim' }, [KEEP]: { name: 'Other' } },
      userChats: {},
    };

    const read = (p) => p.split('/').filter(Boolean)
      .reduce((cur, k) => (cur == null ? cur : cur[k]), store);
    const drop = (p) => {
      const parts = p.split('/').filter(Boolean);
      let cur = store;
      for (let i = 0; i < parts.length - 1; i++) { if (cur == null) return; cur = cur[parts[i]]; }
      if (cur) delete cur[parts[parts.length - 1]];
    };
    const snap = (val, key) => ({
      key,
      exists: () => val !== undefined && val !== null,
      val: () => val,
      forEach: (cb) => {
        if (val && typeof val === 'object') {
          Object.entries(val).forEach(([k, v]) => cb(snap(v, k)));
        }
      },
    });

    db = {
      ref: (p) => ({
        get: async () => {
          if (!asAdmin && DENIED_TO_SELF.includes(p)) {
            throw new Error('PERMISSION_DENIED: Client doesn’t have permission to access ' + p);
          }
          return snap(read(p), p.split('/').pop());
        },
        remove: async () => drop(p),
      }),
    };
    await deleteAllUserData(VICTIM, role);
    return store;
  }, { VICTIM, KEEP, TEACHER, role, asAdmin, DENIED_TO_SELF });
}

test.describe('deleteAllUserData removes everything the user authored', () => {
  test('deletes reviews, pending-review copies and posts by the real author field', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const store = await runDeletion(page, 'student');

    // Authored content is gone — this is what silently survived before.
    expect(store.reviews['teacher-A'].r1, 'review on teacher-A').toBeUndefined();
    expect(store.reviews['teacher-B'].r3, 'review on teacher-B').toBeUndefined();
    expect(store.communityPosts.c1, 'community post').toBeUndefined();
    expect(store.users[VICTIM], 'users record').toBeUndefined();
  });

  test('clears the admin review queue without being able to read it', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const store = await runDeletion(page, 'student');

    // pendingReviews is admin-read-only and carries the author's full name.
    // Both entries must go even though the scan is denied.
    expect(store.pendingReviews.r1, 'pendingReviews copy of r1').toBeUndefined();
    expect(store.pendingReviews.r3, 'pendingReviews copy of r3').toBeUndefined();
  });

  test('deletes every mirror of a booking, without scanning the global node', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const store = await runDeletion(page, 'student');

    // Removing userBookings/<victim> alone left the minor's name and the
    // parent's email sitting in the other two copies.
    expect(store.bookings.b1, 'global booking copy').toBeUndefined();
    expect(store.userBookings[VICTIM], 'victim booking index').toBeUndefined();
    expect(store.teacherBookings[TEACHER].b1, 'teacher-side booking copy').toBeUndefined();
  });

  test('reaches the same data when the admin deletes the user', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const store = await runDeletion(page, 'student', { asAdmin: true });

    expect(store.bookings.b1, 'global booking copy').toBeUndefined();
    expect(store.pendingReviews.r1, 'pendingReviews copy').toBeUndefined();
    expect(store.reviews['teacher-A'].r1, 'review').toBeUndefined();
  });

  test('leaves other users’ content untouched', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const store = await runDeletion(page, 'student');

    expect(store.reviews['teacher-A'].r2, 'other user review').toBeDefined();
    expect(store.pendingReviews.r2, 'other user pendingReview').toBeDefined();
    expect(store.communityPosts.c2, 'other user post').toBeDefined();
    expect(store.users[KEEP], 'other users record').toBeDefined();
    expect(store.bookings.b2, 'other user booking').toBeDefined();
    expect(store.userBookings[KEEP].b2, 'other user booking index').toBeDefined();
    expect(store.teacherBookings[TEACHER].b2, 'other user booking, teacher side').toBeDefined();
  });
});
