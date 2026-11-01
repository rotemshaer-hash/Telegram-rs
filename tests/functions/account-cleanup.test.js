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
const ref = (p) => ({
  get: async () => ({ val: () => data[p], exists: () => data[p] !== undefined }),
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
