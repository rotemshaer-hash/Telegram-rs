// lesson-mail.js: the parent hears about an approved / rejected / completed lesson
// from the server, which reads the address from the student's record. The teacher's
// client never needs (and no longer gets) the child's or parent's contact details.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data; let sent;
const TEACHER = 'teacher-uid'; const STUDENT = 'student-uid'; const OTHER = 'other-teacher';

const fakeDb = {
  ref: (p) => ({
    get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
    remove: async () => { delete data[p]; },
    push: async (v) => { data[p + '/(push)'] = v; },
    transaction: async (fn) => {
      const v = fn(data[p]);
      if (v === undefined) return { committed: false };
      data[p] = v; return { committed: true };
    },
  }),
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: {
    initAdmin: () => {},
    admin: { auth: () => ({ verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t }; } }), database: () => fakeDb },
  },
};
require.cache[resolve('../../netlify/lib/emailjs.js')] = {
  exports: { sendViaEmailJS: async (to, subject, message) => { sent.push({ to, subject, message }); return true; } },
};
const { handler } = require('../../netlify/functions/lesson-mail.js');

const call = async (uid, body) => {
  const res = await handler({
    httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' },
    body: JSON.stringify({ idToken: uid, ...body }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  sent = [];
  data = {
    'bookings/b1': { teacherId: TEACHER, studentId: STUDENT, status: 'approved', teacherName: 'Teach', day: "ב' 3 נוב", time: '10:00', jitsiUrl: 'https://zoom.us/j/1', studentName: 'Kid' },
    [`users/${STUDENT}/name`]: 'Kid',
    [`users/${STUDENT}/parentEmail`]: 'mom@example.org',
    [`users/${STUDENT}/parentName`]: 'Mom',
    [`teacherSummaries/${TEACHER}/b1`]: { topic: 'Fractions', notes: 'Good', homework: 'p. 4' },
  };
});

describe('lesson-mail', () => {
  it('emails the parent on the student record when the booking teacher says it was approved', async () => {
    const r = await call(TEACHER, { bookingId: 'b1', event: 'approved' });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'mom@example.org');
    assert.match(sent[0].message, /Teach/);
    assert.match(sent[0].message, /zoom\.us/);
  });

  it('ignores an address or text in the request: everything comes from the database', async () => {
    const r = await call(TEACHER, { bookingId: 'b1', event: 'approved', parentEmail: 'x@evil.example', teacherName: 'EVIL' });
    assert.equal(r.status, 200);
    assert.equal(sent[0].to, 'mom@example.org');
    assert.doesNotMatch(sent[0].message, /EVIL/);
  });

  it('sends one mail per booking and event', async () => {
    await call(TEACHER, { bookingId: 'b1', event: 'approved' });
    const again = await call(TEACHER, { bookingId: 'b1', event: 'approved' });
    assert.equal(again.body.duplicate, true);
    assert.equal(sent.length, 1);
  });

  it('refuses a teacher who is not the booking’s teacher', async () => {
    const r = await call(OTHER, { bookingId: 'b1', event: 'approved' });
    assert.equal(r.status, 403);
    assert.equal(sent.length, 0);
  });

  it('refuses an event the booking is not in', async () => {
    const r = await call(TEACHER, { bookingId: 'b1', event: 'rejected' });
    assert.equal(r.status, 409);
    assert.equal(sent.length, 0);
  });

  it('sends nothing when there is no real parent address', async () => {
    data[`users/${STUDENT}/parentEmail`] = 'kid@kidemy.app';
    const r = await call(TEACHER, { bookingId: 'b1', event: 'approved' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sent, false);
    assert.equal(sent.length, 0);
  });

  it('a completed lesson carries the summary the teacher saved, read from the database', async () => {
    data['bookings/b1'].status = 'completed';
    const r = await call(TEACHER, { bookingId: 'b1', event: 'completed', notes: 'FROM REQUEST' });
    assert.equal(r.status, 200);
    assert.match(sent[0].message, /Fractions/);
    assert.match(sent[0].message, /p\. 4/);
    assert.doesNotMatch(sent[0].message, /FROM REQUEST/);
  });

  it('rejects a malformed request and a missing session', async () => {
    assert.equal((await call(TEACHER, { bookingId: "x');alert(1);('", event: 'approved' })).status, 400);
    assert.equal((await call(TEACHER, { bookingId: 'b1', event: 'delete-everything' })).status, 400);
    const noToken = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ bookingId: 'b1', event: 'approved' }) });
    assert.equal(noToken.statusCode, 401);
    assert.equal((await call('bad', { bookingId: 'b1', event: 'approved' })).status, 401);
  });
});

describe('lesson-mail: a new booking mails the teacher', () => {
  beforeEach(() => {
    data['bookings/b2'] = { teacherId: TEACHER, studentId: STUDENT, status: 'pending', studentName: 'Kid', day: "ב' 3 נוב", time: '10:00', price: 80 };
    data[`teacherPrivate/${TEACHER}`] = { email: 'teacher@example.org', notificationEmail: 'alerts@example.org' };
  });

  it('the student who booked can trigger it, and it goes to the teacher’s notification address', async () => {
    const r = await call(STUDENT, { bookingId: 'b2', event: 'requested' });
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'alerts@example.org');
    assert.match(sent[0].message, /Kid/);
  });

  it('falls back to the teacher’s email when there is no notification address', async () => {
    delete data[`teacherPrivate/${TEACHER}`].notificationEmail;
    await call(STUDENT, { bookingId: 'b2', event: 'requested' });
    assert.equal(sent[0].to, 'teacher@example.org');
  });

  it('a different student, or the teacher, cannot trigger it', async () => {
    assert.equal((await call('someone-else', { bookingId: 'b2', event: 'requested' })).status, 403);
    assert.equal((await call(TEACHER, { bookingId: 'b2', event: 'requested' })).status, 403);
    assert.equal(sent.length, 0);
  });

  it('only for a booking that is still pending, and once', async () => {
    await call(STUDENT, { bookingId: 'b2', event: 'requested' });
    assert.equal((await call(STUDENT, { bookingId: 'b2', event: 'requested' })).body.duplicate, true);
    data['bookings/b2'].status = 'approved';
    data['lessonMailSent/b2_requested'] = undefined;
    assert.equal((await call(STUDENT, { bookingId: 'b2', event: 'requested' })).status, 409);
  });
});
