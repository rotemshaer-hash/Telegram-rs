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
    };
    await update(ref(db), {
      'users/student-uid': { name: 'Minor', role: 'student', verified: true },
      'users/teacher-uid': { name: 'Teach', role: 'teacher', verified: true },
      'teachers/teacher-uid': { name: 'Teach', verified: true, active: true },
      'teacherVerification/teacher-uid': { idPhoto: 'data:image/png;base64,AAAA' },
      'bookings/b1': booking,
      'userBookings/student-uid/b1': booking,
      'teacherBookings/teacher-uid/b1': booking,
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
