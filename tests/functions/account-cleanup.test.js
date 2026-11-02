// account-cleanup.js removes what only the server holds about a deleted user.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let data;
const ME = 'me-uid'; const OTHER = 'other-uid'; const ADMIN = 'admin-uid';
const T1 = 'a'.repeat(64); const T2 = 'b'.repeat(64);

const children = (p) => {
  const pre = p + '/'; const out = {};
  Object.keys(data).filter((k) => k.startsWith(pre)).forEach((k) => {
    const [id, ...rest] = k.slice(pre.length).split('/'); (out[id] = out[id] || {})[rest.join('/')] = data[k];
  });
  return out;
};
// a snapshot built from the flat path map: val(), exists(), child(), forEach()
const snapOf = (p) => {
  const pre = p + '/';
  const keys = [...new Set(Object.keys(data).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length).split('/')[0]))];
  const tree = () => { const o = {}; keys.forEach((k) => { o[k] = snapOf(p + '/' + k).val(); }); return o; };
  return {
    key: p.split('/').pop(),
    val: () => (data[p] !== undefined ? data[p] : (keys.length ? tree() : null)),
    exists: () => data[p] !== undefined || keys.length > 0,
    child: (k) => snapOf(p + '/' + k),
    forEach: (cb) => keys.forEach((k) => cb(snapOf(p + '/' + k))),
  };
};
const ref = (p) => ({
  update: async (patch) => { Object.keys(patch).forEach((k) => { Object.keys(data).filter((d) => d === k || d.startsWith(k + '/')).forEach((d) => delete data[d]); }); },
  get: async () => snapOf(p),
  remove: async () => { Object.keys(data).filter((k) => k === p || k.startsWith(p + '/')).forEach((k) => delete data[k]); },
  orderByChild: (field) => ({
    equalTo: (v) => ({
      get: async () => {
        const matches = Object.entries(children(p)).filter(([, f]) => f[field] === v);
        return { forEach: (cb) => matches.forEach(([key]) => cb({ key })) };
      },
    }),
  }),
});
const resolve = (rel) => require.resolve(path.join(__dirname, rel));
require.cache[resolve('../../netlify/lib/firebase-admin-init.js')] = {
  exports: {
    initAdmin: () => {},
    admin: {
      auth: () => ({ verifyIdToken: async (t) => { if (t === 'bad') throw new Error('x'); return { uid: t, email: t === ADMIN ? 'rotemshaer@gmail.com' : t + '@example.com' }; } }),
      database: () => ({ ref }),
    },
  },
};
const { handler } = require('../../netlify/functions/account-cleanup.js');
const call = async (token, extra = {}) => {
  const res = await handler({ httpMethod: 'POST', headers: { origin: 'https://kidemy-app.netlify.app' }, body: JSON.stringify({ idToken: token, ...extra }) });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
};

beforeEach(() => {
  data = {
    [`parentConsentByUid/${ME}`]: T1, [`parentConsent/${T1}/uid`]: ME, [`parentConsent/${T1}/parentEmail`]: 'mom@example.org',
    [`parentConsent/${T2}/uid`]: ME, // a superseded one
    [`parentContact/${ME}/email`]: 'mom@example.org', [`parentConsentLog/${ME}/e1/ip`]: '1.1.1.1',
    'parentTokens/t1/uid': ME, 'parentTokens/t2/uid': OTHER,
    'stories/s1/uid': ME, 'stories/s2/uid': OTHER,
    [`parentContact/${OTHER}/email`]: 'other-mom@example.org',
    [`messages/${[ME, OTHER].sort().join('_')}/m1/text`]: 'hi', [`newConversationNotified/${[ME, OTHER].sort().join('_')}`]: true,
    [`messages/${['x-uid', OTHER].sort().join('_')}/m1/text`]: 'not mine',
    [`groupMembers/g1/${ME}/name`]: 'Kid', [`groupMembers/g1/${OTHER}/name`]: 'Other',
    [`messageStats/${ME}/conversations/${OTHER}`]: true, [`referrals/${ME}/${OTHER}/at`]: 1,
    [`teacherQA/${OTHER}/q1/askerUid`]: ME, [`teacherQA/${OTHER}/q2/askerUid`]: 'x-uid', [`teacherQA/${ME}/q9/askerUid`]: OTHER,
    'parentBriefs/b1/parentUid': ME, 'parentBriefs/b2/parentUid': OTHER, 'briefProposals/b1/t/price': 1,
    [`briefProposals/b2/${ME}/price`]: 2, [`briefProposals/b2/${OTHER}/price`]: 3,
    'fcmTokens/f1/uid': ME, 'fcmTokens/f2/uid': OTHER,
  };
});

describe('account-cleanup', () => {
  it('removes every server-held record about the signed-in user and nothing about anyone else', async () => {
    const r = await call(ME);
    assert.equal(r.status, 200);
    for (const p of [`parentConsentByUid/${ME}`, `parentConsent/${T1}`, `parentConsent/${T2}`, `parentContact/${ME}`, `parentConsentLog/${ME}`, 'parentTokens/t1', 'stories/s1']) {
      assert.equal(Object.keys(data).some((k) => k === p || k.startsWith(p + '/')), false, p + ' should be gone');
    }
    assert.equal(data['parentTokens/t2/uid'], OTHER);
    assert.equal(data['stories/s2/uid'], OTHER);
    assert.equal(data[`parentContact/${OTHER}/email`], 'other-mom@example.org');
  });

  it('also removes chats, group memberships, questions, briefs, proposals and tokens — and only theirs', async () => {
    const r = await call(ME, { chatPartners: [OTHER, 'not a uid!'], groupIds: ['g1'], role: 'teacher' });
    assert.equal(r.status, 200);
    const gone = (p) => !Object.keys(data).some((k) => k === p || k.startsWith(p + '/'));
    const chat = [ME, OTHER].sort().join('_');
    for (const p of [`messages/${chat}`, `newConversationNotified/${chat}`, `groupMembers/g1/${ME}`, `messageStats/${ME}`, `referrals/${ME}`, `teacherQA/${OTHER}/q1`, `teacherQA/${ME}`, 'parentBriefs/b1', 'briefProposals/b1', `briefProposals/b2/${ME}`, 'fcmTokens/f1']) assert.equal(gone(p), true, p);
    for (const p of [`messages/${['x-uid', OTHER].sort().join('_')}`, `groupMembers/g1/${OTHER}`, `teacherQA/${OTHER}/q2`, 'parentBriefs/b2', `briefProposals/b2/${OTHER}`, 'fcmTokens/f2']) assert.equal(gone(p), false, p + ' must stay');
  });

  it('a user whose profile still exists cannot wipe the parent address and the consent log', async () => {
    data[`users/${ME}`] = { name: 'Kid' };
    const r = await call(ME);
    assert.equal(r.status, 409);
    assert.equal(data[`parentContact/${ME}/email`], 'mom@example.org');
    assert.equal(data[`parentConsentLog/${ME}/e1/ip`], '1.1.1.1');
  });

  it('a user cannot clean up someone else’s account', async () => {
    const r = await call(ME, { uid: OTHER });
    assert.equal(r.status, 403);
    assert.equal(data[`parentContact/${OTHER}/email`], 'other-mom@example.org');
  });

  it('the admin can clean up another user (deleting an account from the panel)', async () => {
    const r = await call(ADMIN, { uid: OTHER });
    assert.equal(r.status, 200);
    assert.equal(data[`parentContact/${OTHER}/email`], undefined);
    assert.equal(data[`parentContact/${ME}/email`], 'mom@example.org');
  });

  it('needs a valid session', async () => {
    assert.equal((await call('bad')).status, 401);
    const noToken = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    assert.equal(noToken.statusCode, 401);
  });
});
