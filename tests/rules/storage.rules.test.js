// Storage-rule tests, run against the Firebase Storage emulator with the
// real storage.rules.
//
// Why this file exists, and why it exists only now: Firebase Storage was
// never provisioned on the project — every uploadBase64ToStorage call failed
// and fell back to writing the image into the RTDB. storage.rules was
// therefore protecting nothing, and the deploy that publishes it had been
// failing silently for months. The moment Storage is turned on, this file
// is the only thing standing between a minor's identity document and every
// signed-in user, so it is written before that path carries real traffic.
//
// id-photos is the one that matters. The rest are meant to be readable by
// other users, and the tests hold them to that so nobody "hardens" a
// portfolio into an unreadable one.

const { before, after, describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment, assertFails, assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, getBytes, deleteObject } = require('firebase/storage');

const ADMIN_EMAIL = 'rotemshaer@gmail.com';
const OWNER = 'owner-uid';
const OTHER = 'other-uid';

let testEnv;

const asOwner = () => testEnv.authenticatedContext(OWNER, { email: 'owner@example.com' }).storage();
const asOther = () => testEnv.authenticatedContext(OTHER, { email: 'other@example.com' }).storage();
const asAdmin = () => testEnv.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).storage();
const asGuest = () => testEnv.unauthenticatedContext().storage();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image = { contentType: 'image/png' };

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-drushe',
    storage: {
      rules: fs.readFileSync(path.join(__dirname, '../../storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

after(async () => { await testEnv?.cleanup(); });

// Seed with the rules off, so a fixture is never the thing under test.
async function seed(fullPath, bytes = PNG, meta = image) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), fullPath), bytes, meta);
  });
}

// ── THE ID DOCUMENT ────────────────────────────────────────────────────────
// A photo of a minor's identity card. Owner and admin, nobody else, ever.
describe('id-photos: the most sensitive object in the app', () => {
  const mine = `id-photos/${OWNER}/id.png`;

  it('the owner can upload their own document', async () => {
    await assertSucceeds(uploadBytes(ref(asOwner(), mine), PNG, image));
  });

  it('the owner can read it back', async () => {
    await seed(mine);
    await assertSucceeds(getBytes(ref(asOwner(), mine)));
  });

  it('another signed-in user cannot read it', async () => {
    await seed(mine);
    await assertFails(getBytes(ref(asOther(), mine)));
  });

  it('a signed-out visitor cannot read it', async () => {
    await seed(mine);
    await assertFails(getBytes(ref(asGuest(), mine)));
  });

  it('the admin can read it, which the verification panel needs', async () => {
    await seed(mine);
    await assertSucceeds(getBytes(ref(asAdmin(), mine)));
  });

  it('nobody can upload a document into someone else’s folder', async () => {
    await assertFails(uploadBytes(ref(asOther(), mine), PNG, image));
  });

  it('a non-image is refused — the folder is for documents, not payloads', async () => {
    await assertFails(uploadBytes(
      ref(asOwner(), `id-photos/${OWNER}/payload.html`),
      new Uint8Array([0x3c, 0x21]),
      { contentType: 'text/html' }
    ));
  });

  it('an oversized upload is refused', async () => {
    const tooBig = new Uint8Array(15 * 1024 * 1024 + 1024);
    await assertFails(uploadBytes(ref(asOwner(), `id-photos/${OWNER}/big.png`), tooBig, image));
  });

  it('the owner can delete it, which account deletion depends on', async () => {
    await seed(mine);
    await assertSucceeds(deleteObject(ref(asOwner(), mine)));
  });

  it('another user cannot delete it', async () => {
    await seed(mine);
    await assertFails(deleteObject(ref(asOther(), mine)));
  });
});

// ── SHARED MEDIA ───────────────────────────────────────────────────────────
// Meant to be seen by other signed-in users. The tests hold that open on
// purpose: tightening these would break stories, the community feed and
// teacher portfolios without anyone noticing until users complained.
describe('stories, portfolio and communityMedia: readable, owner-written', () => {
  for (const folder of ['stories', 'portfolio', 'communityMedia']) {
    const mine = `${folder}/${OWNER}/a.png`;

    it(`${folder}: the owner uploads`, async () => {
      await assertSucceeds(uploadBytes(ref(asOwner(), mine), PNG, image));
    });

    it(`${folder}: another signed-in user can read it`, async () => {
      await seed(mine);
      await assertSucceeds(getBytes(ref(asOther(), mine)));
    });

    it(`${folder}: a signed-out visitor cannot`, async () => {
      await seed(mine);
      await assertFails(getBytes(ref(asGuest(), mine)));
    });

    it(`${folder}: another user cannot write into your folder`, async () => {
      await assertFails(uploadBytes(ref(asOther(), mine), PNG, image));
    });

    it(`${folder}: the owner can delete their own`, async () => {
      await seed(mine);
      await assertSucceeds(deleteObject(ref(asOwner(), mine)));
    });
  }

  it('stories rejects a non-image', async () => {
    await assertFails(uploadBytes(
      ref(asOwner(), `stories/${OWNER}/x.txt`),
      new Uint8Array([0x61]),
      { contentType: 'text/plain' }
    ));
  });
});

// ── EVERYTHING ELSE ────────────────────────────────────────────────────────
describe('any other path is closed', () => {
  it('a made-up folder is not writable', async () => {
    await assertFails(uploadBytes(ref(asOwner(), `whatever/${OWNER}/a.png`), PNG, image));
  });

  it('the bucket root is not writable', async () => {
    await assertFails(uploadBytes(ref(asOwner(), 'a.png'), PNG, image));
  });

  it('a made-up folder is not readable', async () => {
    await seed('whatever/x/a.png');
    await assertFails(getBytes(ref(asOther(), 'whatever/x/a.png')));
  });
});

// ── LISTING, WHICH ACCOUNT DELETION NEEDS ─────────────────────────────────
// Story and portfolio filenames carry a timestamp, so deletion cannot know
// them in advance — it has to enumerate the folder. If listing is denied,
// deleteAllUserData cannot clean Storage at all.
describe('a user can enumerate their own folders', () => {
  const { listAll } = require('firebase/storage');

  for (const folder of ['id-photos', 'stories', 'portfolio', 'communityMedia']) {
    it(`${folder}: the owner can list their own folder`, async () => {
      await seed(`${folder}/${OWNER}/a.png`);
      await assertSucceeds(listAll(ref(asOwner(), `${folder}/${OWNER}`)));
    });
  }

  it('id-photos: another user cannot list yours', async () => {
    await seed(`id-photos/${OWNER}/a.png`);
    await assertFails(listAll(ref(asOther(), `id-photos/${OWNER}`)));
  });
});
