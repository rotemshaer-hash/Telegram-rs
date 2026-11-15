// id-photo-purge.js: ID photos are deleted 30 days after the team decided — and never before, never twice-marked on failure.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

let tree; let deletedPrefixes; let storageFails;
const segs = (p) => String(p).split('/').filter(Boolean);
const getAt = (p) => segs(p).reduce((n, k) => (n == null ? undefined : n[k]), tree);
const setAt = (p, v) => {
  const s = segs(p);
  if (v === null || v === undefined) { const parent = getAt(s.slice(0, -1).join('/')); if (parent) delete parent[s[s.length - 1]]; return; }
  let n = tree;
  s.slice(0, -1).forEach((k) => { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; });
  n[s[s.length - 1]] = v;
};
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const fakeDb = { ref: (p) => ({
  get: async () => { const v = clone(getAt(p)); return { val: () => (v === undefined ? null : v), exists: () => v !== undefined }; },
  set: async (v) => setAt(p, clone(v)),
  remove: async () => setAt(p, null),
}) };
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
const realInit = require(resolve('../../netlify/lib/firebase-admin-init.js'));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: { ...realInit, initAdmin: () => {}, admin: {
    database: () => fakeDb,
    storage: () => ({ bucket: () => ({ deleteFiles: async ({ prefix }) => { if (storageFails) throw new Error('storage down'); deletedPrefixes.push(prefix); } }) }),
  } },
};
const { handler } = require('../../netlify/functions/id-photo-purge.js');
const { ID_PHOTO_RETENTION_DAYS, DAY_MS } = require('../../netlify/lib/retention');

const NOW = Date.now();
const ago = (days) => NOW - days * DAY_MS;
const run = async () => JSON.parse((await handler({})).body);

beforeEach(() => {
  deletedPrefixes = []; storageFails = false;
  tree = {
    users: { kid: { name: 'דנה', parentIdPhoto: 'data:image/png;base64,AAA', parentId: '123456782', verified: true } },
    teacherVerification: {}, teachers: {}, idPurgeDue: {},
  };
});

describe('id-photo-purge: the queue (decisions the admin recorded)', () => {
  it('deletes the parent’s ID photo once the due date has come, and keeps the facts', async () => {
    tree.idPurgeDue.kid = NOW - 1000;
    const r = await run();
    assert.deepEqual(r.purged, ['kid']);
    assert.equal(tree.users.kid.parentIdPhoto, undefined);
    assert.equal(typeof tree.users.kid.idPhotosPurgedAt, 'number');
    assert.equal(tree.users.kid.parentId, '123456782', 'the number and the rest of the record are untouched');
    assert.equal(tree.users.kid.name, 'דנה');
    assert.equal(tree.idPurgeDue.kid, undefined, 'the queue entry is cleared');
    assert.deepEqual(deletedPrefixes, ['id-photos/kid/']);
  });

  it('never deletes before the due date', async () => {
    tree.idPurgeDue.kid = NOW + 5 * DAY_MS;
    const r = await run();
    assert.deepEqual(r.purged, []);
    assert.ok(tree.users.kid.parentIdPhoto);
    assert.deepEqual(deletedPrefixes, []);
  });

  it('a failed Storage delete leaves everything in place for tomorrow — nothing is marked as purged', async () => {
    tree.idPurgeDue.kid = NOW - 1000;
    tree.teacherVerification.kid = { idPhoto: 'https://storage/x', updatedAt: 1 };
    storageFails = true;
    const r = await run();
    assert.deepEqual(r.failed, ['kid']);
    assert.ok(tree.users.kid.parentIdPhoto, 'the parent photo is still there');
    assert.ok(tree.teacherVerification.kid.idPhoto, 'the teacher photo reference is still there');
    assert.equal(tree.users.kid.idPhotosPurgedAt, undefined);
    assert.ok(tree.idPurgeDue.kid, 'still queued');
    storageFails = false;
    assert.deepEqual((await run()).purged, ['kid'], 'the next run finishes the job');
  });

  it('also removes the teacher’s Storage files, the reference and the old copy inside the record', async () => {
    tree.idPurgeDue.kid = NOW - 1;
    tree.teacherVerification.kid = { idPhoto: 'https://storage/x', updatedAt: 1 };
    tree.teachers.kid = { ageVerification: { age: 15, status: 'verified', idType: 'id', idPhoto: 'data:image/png;base64,OLD' } };
    await run();
    assert.equal(tree.teacherVerification.kid.idPhoto, undefined);
    assert.equal(tree.teachers.kid.ageVerification.idPhoto, undefined);
    assert.equal(tree.teachers.kid.ageVerification.age, 15);
    assert.equal(tree.teachers.kid.ageVerification.status, 'verified');
  });

  it('ignores a malformed uid or a non-numeric due value', async () => {
    tree.idPurgeDue['a/../b'] = NOW - 1; tree.idPurgeDue.kid = 'soon';
    const r = await run();
    assert.ok(r.failed.includes('a/../b'));
    assert.deepEqual(deletedPrefixes, []);
    assert.ok(tree.users.kid.parentIdPhoto);
  });
});

describe('id-photo-purge: a teacher who uploaded a document after being verified', () => {
  const teacher = (over = {}) => {
    tree.teacherVerification.t1 = { idPhoto: 'https://storage/t1', updatedAt: ago(40), ...over.tv };
    tree.teachers.t1 = { ageVerification: { status: 'verified', verifiedAt: ago(45), ...over.av } };
    if (over.rejectedAt) tree.users.t1 = { rejectedAt: over.rejectedAt };
  };

  it('is purged 30 days after the later of the verification and the upload', async () => {
    teacher();
    assert.deepEqual((await run()).purged, ['t1']);
    assert.equal(tree.teacherVerification.t1.idPhoto, undefined);
  });

  it('a fresh upload restarts the clock', async () => {
    teacher({ tv: { updatedAt: ago(3) } });
    assert.deepEqual((await run()).purged, []);
    assert.ok(tree.teacherVerification.t1.idPhoto);
  });

  it('a document nobody has decided on yet is NOT deleted, however old', async () => {
    tree.teacherVerification.t1 = { idPhoto: 'https://storage/t1', updatedAt: ago(200) };
    tree.teachers.t1 = { ageVerification: { status: 'pending' } };
    assert.deepEqual((await run()).purged, []);
    assert.ok(tree.teacherVerification.t1.idPhoto);
  });

  it('a rejected teacher’s document is purged 30 days after the rejection', async () => {
    tree.teacherVerification.t1 = { idPhoto: 'https://storage/t1', updatedAt: ago(100) };
    tree.users.t1 = { rejectedAt: ago(31) };
    assert.deepEqual((await run()).purged, ['t1']);
    tree.teacherVerification.t2 = { idPhoto: 'https://storage/t2', updatedAt: ago(100) };
    tree.users.t2 = { rejectedAt: ago(5) };
    assert.deepEqual((await run()).purged, [], 'a rejection from 5 days ago is still inside the window');
  });
});

describe('the retention period is stated once per side and the sides agree', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  it('index.html holds the same number of days as the server', () => {
    const m = read('../../index.html').match(/const ID_PHOTO_RETENTION_DAYS=(\d+)/);
    assert.ok(m, 'index.html defines ID_PHOTO_RETENTION_DAYS');
    assert.equal(Number(m[1]), ID_PHOTO_RETENTION_DAYS);
  });
  it('the privacy policy tells users the same number', () => {
    const html = read('../../privacy.html');
    assert.match(html, new RegExp('נמחקים אוטומטית[^<]{0,60}<strong>' + ID_PHOTO_RETENTION_DAYS + ' יום</strong>'));
  });
  it('the schedule exists in netlify.toml', () => {
    assert.match(read('../../netlify.toml'), /\[functions\."id-photo-purge"\]\s+schedule = "/);
  });
});
