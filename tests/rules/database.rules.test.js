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
