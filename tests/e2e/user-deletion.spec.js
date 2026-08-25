const { test, expect } = require('@playwright/test');

// Guards deleteAllUserData against the class of bug that shipped twice:
// the deletion code looked for a field name the writing code never writes,
// so it silently matched nothing and "deleted" the user while leaving their
// reviews and community posts (with their real name attached) in the DB.
//
// The field names asserted here are the ones the app actually writes:
//   reviews / pendingReviews -> author is `from`     (NOT `uid`)
//   communityPosts           -> author is `authUid`  (NOT `uid`)
// If someone renames one side without the other, these fail instead of the
// mismatch being discovered from a user's Firebase console screenshot.
//
// db is a plain `var` in index.html, so the real shipped deleteAllUserData
// is exercised here against a seeded in-memory store — not a reimplementation.

const VICTIM = 'victim-uid';
const KEEP = 'other-uid';

async function runDeletion(page, role) {
  return page.evaluate(async ({ VICTIM, KEEP, role }) => {
    const store = {
      reviews: {
        'teacher-A': {
          r1: { from: VICTIM, fromName: 'Victim', review: 'bad', stars: 1 },
          r2: { from: KEEP, fromName: 'Other', review: 'good', stars: 5 },
        },
        'teacher-B': { r3: { from: VICTIM, fromName: 'Victim', stars: 3 } },
      },
      pendingReviews: {
        p1: { from: VICTIM, fromName: 'Victim', reviewId: 'r1' },
        p2: { from: KEEP, fromName: 'Other', reviewId: 'r2' },
      },
      communityPosts: {
        c1: { authUid: VICTIM, author: 'Victim', text: 'hello' },
        c2: { authUid: KEEP, author: 'Other', text: 'hi' },
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

    db = { ref: (p) => ({ get: async () => snap(read(p), p.split('/').pop()), remove: async () => drop(p) }) };
    await deleteAllUserData(VICTIM, role);
    return store;
  }, { VICTIM, KEEP, role });
}

test.describe('deleteAllUserData removes everything the user authored', () => {
  test('deletes reviews, pending-review copies and posts by the real author field', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const store = await runDeletion(page, 'student');

    // Authored content is gone — this is what silently survived before.
    expect(store.reviews['teacher-A'].r1, 'review on teacher-A').toBeUndefined();
    expect(store.reviews['teacher-B'].r3, 'review on teacher-B').toBeUndefined();
    expect(store.pendingReviews.p1, 'pendingReviews copy (carries the name)').toBeUndefined();
    expect(store.communityPosts.c1, 'community post').toBeUndefined();
    expect(store.users[VICTIM], 'users record').toBeUndefined();
  });

  test('leaves other users’ content untouched', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const store = await runDeletion(page, 'student');

    expect(store.reviews['teacher-A'].r2, 'other user review').toBeDefined();
    expect(store.pendingReviews.p2, 'other user pendingReview').toBeDefined();
    expect(store.communityPosts.c2, 'other user post').toBeDefined();
    expect(store.users[KEEP], 'other users record').toBeDefined();
  });
});
