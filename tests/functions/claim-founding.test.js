// claim-founding.js: only the server decides who is a founding teacher (first 500), and only a real teacher can claim.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

let data; let teacherCount;
const fakeDb = {
  ref: (p) => ({
    get: async () => {
      if (p === 'teachers') {
        const keys = Array.from({ length: teacherCount }, (_, i) => 't' + i);
        return { exists: () => keys.length > 0, forEach: (cb) => keys.forEach((k) => cb({ key: k })) };
      }
      return { val: () => data[p], exists: () => data[p] !== undefined };
    },
    set: async (v) => { data[p] = v; },
    transaction: async (fn) => { const v = fn(data[p]); if (v === undefined) return { committed: false }; data[p] = v; return { committed: true }; },
  }),
};
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: { initAdmin: () => {}, admin: { auth: () => ({ verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t }; } }), database: () => fakeDb } },
};
const mod = require('../../netlify/functions/claim-founding.js');
const call = async (uid) => {
  const res = await mod.handler({ httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' }, body: JSON.stringify({ idToken: uid }) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  teacherCount = 10;
  data = { 'teachers/teach': { name: 'T' }, 'users/teach/role': 'teacher', 'teachers/x': {} };
});

describe('claim-founding', () => {
  it('the limit is the same number the client shows', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    assert.match(html, new RegExp('FOUNDING_TEACHER_LIMIT=' + mod.FOUNDING_TEACHER_LIMIT + ';'));
  });
  it('a real teacher within the first 500 becomes a founder; asking again changes nothing', async () => {
    assert.equal((await call('teach')).body.founding, true);
    assert.equal(data['users/teach/foundingMember'], true);
    assert.equal((await call('teach')).body.unchanged, true);
  });
  it('the 501st teacher is not a founder', async () => {
    teacherCount = 501;
    assert.equal((await call('teach')).body.founding, false);
    assert.equal(data['users/teach/foundingMember'], undefined);
  });
  it('a student, a stranger or a bad session cannot claim', async () => {
    data['users/kid/role'] = 'student';
    assert.equal((await call('kid')).status, 403);
    assert.equal((await call('nobody')).status, 403);
    assert.equal((await call('bad')).status, 401);
  });
});
