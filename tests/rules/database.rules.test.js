// Security-rule tests, run against the Firebase RTDB emulator with the real
// database.rules.json.
//
// Why this file exists: deletion code shipped four times looking correct and
// deleting nothing, because it read nodes the rules would not let it read.
// The denial was swallowed by a catch and the account "deleted successfully".
// Unit tests over the app's JS cannot see that — only the rules can tell us,
// so they are tested directly here.
//
// Two kinds of assertion live here, and both matter:
//   * PRIVACY  — what a user must not be able to reach.
//   * CONTRACT — what deleteAllUserData depends on being allowed. If someone
//                tightens a rule that account deletion needs, this fails here
//                rather than silently leaving a minor's data behind.

const { before, after, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment, assertFails, assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { ref, get, set, remove, update } = require('firebase/database');

const ADMIN_EMAIL = 'rotemshaer@gmail.com';
const STUDENT = 'student-uid';
const TEACHER = 'teacher-uid';
const STRANGER = 'stranger-uid';

let testEnv;

const asStudent = () => testEnv.authenticatedContext(STUDENT, { email: 'student@example.com' }).database();
const asTeacher = () => testEnv.authenticatedContext(TEACHER, { email: 'teacher@example.com' }).database();
const asStranger = () => testEnv.authenticatedContext(STRANGER, { email: 'stranger@example.com' }).database();
const asAdmin = () => testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).database();
const asGuest = () => testEnv.unauthenticatedContext().database();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-drushe',
    database: {
      rules: fs.readFileSync(path.join(__dirname, '../../database.rules.json'), 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
  });
});

after(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearDatabase();
  // Seed as if the rules were off, so the fixtures themselves are never the
  // thing under test.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    const booking = {
      studentId: STUDENT, teacherId: TEACHER,
      studentName: 'Minor', studentEmail: 'minor@example.com',
      parentName: 'Parent', parentEmail: 'parent@example.com',
      price: 80, createdAt: 1, status: 'pending',
    };
    // A completed booking between the same pair, for the review tests: a
    // review must point at a real, qualifying booking. And an approved one,
    // for the transitions that start there.
    const completedBooking = { ...booking, status: 'completed', price: 80 };
    const approvedBooking = { ...booking, status: 'approved' };
    await update(ref(db), {
      'users/student-uid': { name: 'Minor', role: 'student', verified: true },
      'users/teacher-uid': { name: 'Teach', role: 'teacher', verified: true },
      'teachers/teacher-uid': { name: 'Teach', verified: true, active: true },
      'teacherVerification/teacher-uid': { idPhoto: 'data:image/png;base64,AAAA' },
      'bookings/b1': booking,
      'userBookings/student-uid/b1': booking,
      'teacherBookings/teacher-uid/b1': booking,
      'bookings/b2': completedBooking,
      'bookings/b4': approvedBooking,
      'reviews/teacher-uid/rev1': { from: STUDENT, fromName: 'Minor', stars: 5, approved: false },
      'pendingReviews/rev1': { from: STUDENT, fromName: 'Minor', reviewId: 'rev1' },
      'reports/rep1': { from: STUDENT, about: TEACHER, text: 'unsafe behaviour', status: 'open' },
      'pendingCategories/pc1': { teacherId: TEACHER, category: 'Chess', status: 'pending' },
      'messages/student-uid_teacher-uid/m1': { from: STUDENT, text: 'hi', createdAt: 1 },
    });
  });
});

// ── PRIVACY ────────────────────────────────────────────────────────────────
describe('privacy: what a user must not reach', () => {
  it('a stranger cannot read another user’s record', async () => {
    await assertFails(get(ref(asStranger(), 'users/student-uid')));
  });

  it('a stranger cannot read a teacher’s ID document', async () => {
    await assertFails(get(ref(asStranger(), 'teacherVerification/teacher-uid')));
  });

  it('a stranger cannot read someone else’s booking', async () => {
    await assertFails(get(ref(asStranger(), 'bookings/b1')));
  });

  it('a stranger cannot read someone else’s private messages', async () => {
    await assertFails(get(ref(asStranger(), 'messages/student-uid_teacher-uid')));
  });

  it('a normal user cannot read the admin review queue', async () => {
    await assertFails(get(ref(asStudent(), 'pendingReviews')));
  });

  it('a normal user cannot read abuse reports', async () => {
    await assertFails(get(ref(asStudent(), 'reports')));
  });

  it('a guest cannot read anything', async () => {
    await assertFails(get(ref(asGuest(), 'teachers')));
  });

  it('a student cannot mark themselves verified', async () => {
    await assertFails(set(ref(asStudent(), 'users/student-uid/verified'), true));
  });

  it('a teacher cannot mark their own profile verified', async () => {
    await assertFails(set(ref(asTeacher(), 'teachers/teacher-uid/verified'), true));
  });

  it('a user cannot approve their own review', async () => {
    await assertFails(set(ref(asStudent(), 'reviews/teacher-uid/rev1/approved'), true));
  });
});

// ── DESTRUCTION ────────────────────────────────────────────────────────────
// A node-level ".write" grants the whole subtree. Where the intent is "anyone
// may submit one", that accidentally also means "anyone may delete them all".
describe('destruction: an ordinary user cannot wipe shared queues', () => {
  it('cannot delete every abuse report', async () => {
    await assertFails(remove(ref(asStudent(), 'reports')));
  });

  it('cannot delete someone else’s abuse report', async () => {
    await assertFails(remove(ref(asTeacher(), 'reports/rep1')));
  });

  it('cannot wipe the admin review queue', async () => {
    await assertFails(remove(ref(asStudent(), 'pendingReviews')));
  });

  it('cannot delete someone else’s pending review', async () => {
    await assertFails(remove(ref(asTeacher(), 'pendingReviews/rev1')));
  });

  it('cannot wipe pending category suggestions', async () => {
    await assertFails(remove(ref(asStudent(), 'pendingCategories')));
  });
});

// ── CONTRACT ───────────────────────────────────────────────────────────────
// Everything deleteAllUserData relies on. If one of these starts failing, an
// account deletion is silently leaving data behind.
describe('contract: what account deletion depends on', () => {
  it('a user can still file a report', async () => {
    await assertSucceeds(set(ref(asStudent(), 'reports/new1'),
      { from: STUDENT, about: TEACHER, text: 'x', status: 'open' }));
  });

  it('a teacher can still suggest a category', async () => {
    await assertSucceeds(set(ref(asTeacher(), 'pendingCategories/new1'),
      { teacherId: TEACHER, category: 'Go', status: 'pending' }));
  });

  it('a user can still submit a review into the admin queue', async () => {
    await assertSucceeds(set(ref(asStudent(), 'pendingReviews/rev2'),
      { from: STUDENT, fromName: 'Minor', reviewId: 'rev2' }));
  });

  it('a user can delete their own pending review without reading the queue', async () => {
    await assertSucceeds(remove(ref(asStudent(), 'pendingReviews/rev1')));
  });

  it('a user can read their own booking index', async () => {
    await assertSucceeds(get(ref(asStudent(), 'userBookings/student-uid')));
    await assertSucceeds(get(ref(asTeacher(), 'teacherBookings/teacher-uid')));
  });

  it('scanning the global bookings node is denied — deletion must not rely on it', async () => {
    await assertFails(get(ref(asStudent(), 'bookings')));
  });

  // Order matters, and it is not obvious from reading the rules.
  // teacherBookings/$uid/$id is writable by whoever
  // root.child('bookings/'+id+'/studentId') names, and userBookings/$uid/$id by
  // whoever its teacherId names. Both permissions are read off the global
  // record, so deleting that record first revokes the right to delete the
  // mirrors — and the copy holding the minor's name survives.
  it('a participant can delete all three copies — mirrors first', async () => {
    await assertSucceeds(remove(ref(asStudent(), 'userBookings/student-uid/b1')));
    await assertSucceeds(remove(ref(asStudent(), 'teacherBookings/teacher-uid/b1')));
    await assertSucceeds(remove(ref(asStudent(), 'bookings/b1')));
  });

  it('the other participant can delete all three too — mirrors first', async () => {
    await assertSucceeds(remove(ref(asTeacher(), 'teacherBookings/teacher-uid/b1')));
    await assertSucceeds(remove(ref(asTeacher(), 'userBookings/student-uid/b1')));
    await assertSucceeds(remove(ref(asTeacher(), 'bookings/b1')));
  });

  // The trap itself, asserted so nobody "simplifies" the order back.
  it('deleting the global record first strands the counterparty’s copy', async () => {
    await assertSucceeds(remove(ref(asStudent(), 'bookings/b1')));
    await assertFails(remove(ref(asStudent(), 'teacherBookings/teacher-uid/b1')));
  });

  it('a user can delete their own review and profile data', async () => {
    await assertSucceeds(remove(ref(asStudent(), 'reviews/teacher-uid/rev1')));
    await assertSucceeds(remove(ref(asStudent(), 'users/student-uid')));
  });

  it('a teacher can delete their own ID document', async () => {
    await assertSucceeds(remove(ref(asTeacher(), 'teacherVerification/teacher-uid')));
  });

  it('the admin can read the whole tree, which the admin delete paths rely on', async () => {
    await assertSucceeds(get(ref(asAdmin(), 'bookings')));
    await assertSucceeds(get(ref(asAdmin(), 'pendingReviews')));
    await assertSucceeds(get(ref(asAdmin(), 'reports')));
  });
});

// ── GATEKEEPING ────────────────────────────────────────────────────────────
//
// adminApproveTeacher refuses to release a teacher to children unless
// teachers/<uid>/ageVerification/status reads 'verified'. That guard lives in
// the client and only reads the field, so it is worth exactly as much as the
// rule that decides who may write it. Without these tests a teacher can set
// the flag on themselves and the guard waves them through — the same shape as
// the chat-membership hole, where the check consulted a node its own subject
// controlled.
describe('gatekeeping: a teacher cannot vouch for their own document', () => {
  it('a teacher cannot mark their own age verification as verified', async () => {
    await assertFails(
      set(ref(asTeacher(), 'teachers/teacher-uid/ageVerification/status'), 'verified'));
  });

  it('registration still works: pending is allowed', async () => {
    await assertSucceeds(
      set(ref(asTeacher(), 'teachers/teacher-uid/ageVerification'),
        { age: 17, idType: 'id', status: 'pending', submittedAt: 1 }));
  });

  it('a teacher cannot smuggle verified in through a whole-object write', async () => {
    await assertFails(
      set(ref(asTeacher(), 'teachers/teacher-uid/ageVerification'),
        { age: 17, idType: 'id', status: 'verified', submittedAt: 1 }));
  });

  it('a teacher cannot forge the audit trail of who verified them', async () => {
    await assertFails(
      set(ref(asTeacher(), 'teachers/teacher-uid/ageVerification/verifiedBy'), 'admin'));
    await assertFails(
      set(ref(asTeacher(), 'teachers/teacher-uid/ageVerification/verifiedAt'), 1));
    await assertFails(
      set(ref(asTeacher(), 'teachers/teacher-uid/ageVerification/verifiedWithoutDoc'), false));
  });

  it('a stranger cannot verify someone else either', async () => {
    await assertFails(
      set(ref(asStranger(), 'teachers/teacher-uid/ageVerification/status'), 'verified'));
  });

  it('the admin can verify, which is what adminVerifyAge does', async () => {
    await assertSucceeds(
      set(ref(asAdmin(), 'teachers/teacher-uid/ageVerification/status'), 'verified'));
    await assertSucceeds(
      set(ref(asAdmin(), 'teachers/teacher-uid/ageVerification/verifiedBy'), 'admin-uid'));
  });

  it('account deletion still clears the node, which .validate must not block', async () => {
    await assertSucceeds(remove(ref(asTeacher(), 'teachers/teacher-uid/ageVerification')));
  });
});

// ── EXTERNAL REVIEW ────────────────────────────────────────────────────────
//
// An outside engineer reviewed the rules and found a third instance of the
// pattern this file already exists to catch: a decision made from a field the
// subject of that decision controls.
//
// adminVerifyStudent reads users/<uid>/parentConsentAt. When it is set the
// admin is shown "the parent approved on <date>, approve?"; when it is not,
// a red "the parent has NOT approved — approve anyway?". Nothing stopped the
// child writing that timestamp on themselves and turning the warning green.
// The consent function runs with the admin SDK and bypasses rules, so locking
// the field to the admin does not affect the real flow.
//
// The rest are containment: a schedule says when a minor is home and free, and
// two nodes accepted writes from any signed-in user for any other user.
describe('external review: fields their own subject must not write', () => {
  it('a student cannot claim their own parent consented', async () => {
    await assertFails(
      set(ref(asStudent(), 'users/student-uid/parentConsentAt'), Date.now()));
  });

  it('the student can still write the rest of their profile', async () => {
    await assertSucceeds(set(ref(asStudent(), 'users/student-uid/name'), 'Minor'));
  });

  it('a stranger cannot read a student’s schedule', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), 'schedules/student-uid'), { mon_16: true });
    });
    await assertFails(get(ref(asStranger(), 'schedules/student-uid')));
  });

  it('a teacher’s schedule stays readable, which booking depends on', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), 'schedules/teacher-uid'), { mon_16: true });
    });
    await assertSucceeds(get(ref(asStudent(), 'schedules/teacher-uid')));
  });

  it('a user can still read and write their own schedule', async () => {
    await assertSucceeds(set(ref(asStudent(), 'schedules/student-uid'), { tue_10: true }));
    await assertSucceeds(get(ref(asStudent(), 'schedules/student-uid')));
  });

  it('a stranger cannot forge message stats for someone else', async () => {
    await assertFails(
      set(ref(asStranger(), 'messageStats/teacher-uid/conversations/student-uid'), { firstMessageAt: 1 }));
  });

  it('a sender can write their own conversation stats', async () => {
    await assertSucceeds(
      set(ref(asStudent(), 'messageStats/teacher-uid/conversations/student-uid'), { firstMessageAt: 1 }));
  });

  it('a user cannot register someone else as a referral', async () => {
    await assertFails(
      set(ref(asStranger(), 'referrals/teacher-uid/student-uid'), { at: 1, code: 'X' }));
  });

  it('a new user can register themselves once, and not overwrite it', async () => {
    await assertSucceeds(
      set(ref(asStudent(), 'referrals/teacher-uid/student-uid'), { at: 1, code: 'X' }));
    await assertFails(
      set(ref(asStudent(), 'referrals/teacher-uid/student-uid'), { at: 2, code: 'Y' }));
  });
});

describe('newConversationNotified: one parent-notification email per conversation', () => {
  const chatId = 'student-uid_teacher-uid';

  it('a participant can flag a new conversation once', async () => {
    await assertSucceeds(set(ref(asStudent(), `newConversationNotified/${chatId}`), Date.now()));
  });

  it('a participant cannot re-flag it and trigger a second email', async () => {
    await assertSucceeds(set(ref(asStudent(), `newConversationNotified/${chatId}`), Date.now()));
    await assertFails(set(ref(asStudent(), `newConversationNotified/${chatId}`), Date.now()));
  });

  it('a stranger to the conversation cannot flag it', async () => {
    await assertFails(set(ref(asStranger(), `newConversationNotified/${chatId}`), Date.now()));
  });
});

// ── PARENT CONSENT: server-only ──────────────────────────────────────────
//
// An outside review found that the client (the registering minor's own
// browser) generated the consent token, wrote the parentConsent record
// itself, and built the approval link — meaning the token passed through
// code the minor could inspect, and approving their own record required
// nothing a parent did. netlify/functions/parent-consent.js now creates the
// record with the admin SDK, which bypasses these rules entirely; what
// closes the hole is that the client path is gone.
describe('parentConsent: only the server (admin SDK) may write it', () => {
  it('a student cannot create their own consent record', async () => {
    await assertFails(set(ref(asStudent(), 'parentConsent/sometoken'), {
      uid: STUDENT, studentName: 'Minor', parentEmail: 'parent@example.com',
      status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 1000,
    }));
  });

  it('a student cannot self-approve an existing record either', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), 'parentConsent/sometoken'), {
        uid: STUDENT, studentName: 'Minor', parentEmail: 'parent@example.com',
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 1000,
      });
    });
    await assertFails(set(ref(asStudent(), 'parentConsent/sometoken/status'), 'approved'));
  });

  it('the admin can still write it, which the server function relies on', async () => {
    await assertSucceeds(set(ref(asAdmin(), 'parentConsent/sometoken'), {
      uid: STUDENT, studentName: 'Minor', parentEmail: 'parent@example.com',
      status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 1000,
    }));
  });
});

// ── BOOKING: immutable fields ────────────────────────────────────────────
//
// The review found that either party to a booking could rewrite it after
// creation — including the price and who the two parties even are — because
// only status-shaped writes were exercised by the app, and nothing in the
// rules said those fields, once set, must stay set.
describe('bookings: price and the two parties cannot change after creation', () => {
  it('the student cannot change the price', async () => {
    await assertFails(set(ref(asStudent(), 'bookings/b1/price'), 999));
  });

  it('the teacher cannot change the price either', async () => {
    await assertFails(set(ref(asTeacher(), 'bookings/b1/price'), 1));
  });

  it('neither party can reassign the booking to someone else', async () => {
    await assertFails(set(ref(asStudent(), 'bookings/b1/teacherId'), STRANGER));
    await assertFails(set(ref(asTeacher(), 'bookings/b1/studentId'), STRANGER));
  });

  it('createdAt cannot be backdated or bumped', async () => {
    await assertFails(set(ref(asStudent(), 'bookings/b1/createdAt'), 999));
  });

  it('the same lock holds on the userBookings and teacherBookings mirrors', async () => {
    await assertFails(set(ref(asStudent(), 'userBookings/student-uid/b1/price'), 999));
    await assertFails(set(ref(asTeacher(), 'teacherBookings/teacher-uid/b1/price'), 999));
  });

  it('the admin can still correct any field', async () => {
    await assertSucceeds(set(ref(asAdmin(), 'bookings/b1/price'), 50));
  });
});

// ── BOOKING STATE MACHINE ────────────────────────────────────────────────
//
// Locking the fields left the one field the app does write wide open: any
// value, from any state, by either party. "cancelled" could go back to
// "approved", a rejected booking could approve itself, and a student could
// approve their own request — which is the one that matters, because an
// approved booking is what unlocks the lesson and, now, the review.
//
// The machine, as the app actually drives it:
//   (new)     → pending
//   pending   → approved | rejected   (teacher only)
//   pending   → cancelled             (either party)
//   approved  → completed             (teacher only)
//   approved  → cancelled             (either party)
//   completed | rejected | cancelled  → terminal
describe('bookings: only the real state transitions are allowed', () => {
  it('a booking can only be created as pending', async () => {
    await assertSucceeds(set(ref(asStudent(), 'bookings/new1'),
      { studentId: STUDENT, teacherId: TEACHER, price: 80, createdAt: 2, status: 'pending' }));
    await assertFails(set(ref(asStudent(), 'bookings/new2'),
      { studentId: STUDENT, teacherId: TEACHER, price: 80, createdAt: 2, status: 'approved' }));
  });

  // The negative goes first on purpose: rewriting a status to the value it
  // already holds is a no-op and stays allowed, so approving as the teacher
  // first would make the student's attempt vacuously legal.
  it('the teacher approves and rejects; the student cannot', async () => {
    await assertFails(set(ref(asStudent(), 'bookings/b1/status'), 'approved'));
    await assertFails(set(ref(asStudent(), 'bookings/b1/status'), 'rejected'));
    await assertSucceeds(set(ref(asTeacher(), 'bookings/b1/status'), 'approved'));
  });

  it('the teacher completes an approved lesson; the student cannot', async () => {
    await assertFails(set(ref(asStudent(), 'bookings/b4/status'), 'completed'));
    await assertSucceeds(set(ref(asTeacher(), 'bookings/b4/status'), 'completed'));
  });

  it('either party can cancel — pending or approved', async () => {
    await assertSucceeds(set(ref(asStudent(), 'bookings/b1/status'), 'cancelled'));
    await assertSucceeds(set(ref(asTeacher(), 'bookings/b4/status'), 'cancelled'));
  });

  it('a completed booking is terminal — it cannot be reopened', async () => {
    await assertFails(set(ref(asTeacher(), 'bookings/b2/status'), 'approved'));
    await assertFails(set(ref(asTeacher(), 'bookings/b2/status'), 'pending'));
    await assertFails(set(ref(asStudent(), 'bookings/b2/status'), 'pending'));
  });

  it('a cancelled booking cannot walk back to approved', async () => {
    await assertSucceeds(set(ref(asTeacher(), 'bookings/b4/status'), 'cancelled'));
    await assertFails(set(ref(asTeacher(), 'bookings/b4/status'), 'approved'));
  });

  it('a rejected booking cannot approve itself afterwards', async () => {
    await assertSucceeds(set(ref(asTeacher(), 'bookings/b1/status'), 'rejected'));
    await assertFails(set(ref(asTeacher(), 'bookings/b1/status'), 'approved'));
  });

  it('a pending booking cannot skip straight to completed', async () => {
    await assertFails(set(ref(asTeacher(), 'bookings/b1/status'), 'completed'));
  });

  it('rewriting the same status is still allowed — retries must not break', async () => {
    await assertSucceeds(set(ref(asTeacher(), 'bookings/b4/status'), 'approved'));
  });

  it('the admin can force any transition', async () => {
    await assertSucceeds(set(ref(asAdmin(), 'bookings/b2/status'), 'approved'));
  });
});

// ── REVIEWS: must point at a real, qualifying booking ────────────────────
//
// The review found reviews/$teacherId/$reviewId writable by anyone claiming
// to be the author, with no check that a booking between the two ever
// existed, completed or not — and no protection against writing the same
// review twice. Reviews are now keyed by bookingId instead of a random push
// id, which turns "one review per lesson" into a plain create-only rule and
// lets a rule look the specific booking up by id to verify it.
describe('reviews: keyed by bookingId, and the booking must qualify', () => {
  const review = (from, to) => ({
    from, to, stars: 5, review: 'Great!', type: 'studentToTeacher',
    approved: false, createdAt: Date.now(), bookingId: 'b2',
  });

  it('a student can review after a completed booking', async () => {
    await assertSucceeds(set(ref(asStudent(), 'reviews/teacher-uid/b2'), review(STUDENT, TEACHER)));
  });

  it('cannot review a second time against the same booking', async () => {
    await assertSucceeds(set(ref(asStudent(), 'reviews/teacher-uid/b2'), review(STUDENT, TEACHER)));
    await assertFails(set(ref(asStudent(), 'reviews/teacher-uid/b2'), review(STUDENT, TEACHER)));
  });

  it('cannot review against a booking that is only pending', async () => {
    // b1 has no status field at all, i.e. not approved or completed.
    await assertFails(set(ref(asStudent(), 'reviews/teacher-uid/b1'), review(STUDENT, TEACHER)));
  });

  it('cannot review a teacher with a booking id that belongs to someone else', async () => {
    await assertFails(set(ref(asStranger(), 'reviews/teacher-uid/b2'), review(STRANGER, TEACHER)));
  });

  it('cannot review with a made-up booking id', async () => {
    await assertFails(set(ref(asStudent(), 'reviews/teacher-uid/nope'),
      { ...review(STUDENT, TEACHER), bookingId: 'nope' }));
  });

  it('cannot forge the "from" field to impersonate another reviewer', async () => {
    await assertFails(set(ref(asStudent(), 'reviews/teacher-uid/b2'), review(TEACHER, TEACHER)));
  });

  it('the author can still delete their own review, which account deletion needs', async () => {
    await assertSucceeds(set(ref(asStudent(), 'reviews/teacher-uid/b2'), review(STUDENT, TEACHER)));
    await assertSucceeds(remove(ref(asStudent(), 'reviews/teacher-uid/b2')));
  });
});
