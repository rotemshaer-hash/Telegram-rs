// The CORS origin list is one module, not three copies. Moving the site to
// drushe.com means editing allowed-origins.js — if a function carries its own
// list again, that move silently breaks it (the browser blocks the response).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const origins = require('../../netlify/lib/allowed-origins');
const FUNCTIONS = path.join(__dirname, '../../netlify/functions');

describe('allowed origins', () => {
  it('serves the current site, the new domain, the native app and local dev', () => {
    for (const o of ['https://kidemy-app.netlify.app', 'https://drushe.com', 'https://www.drushe.com', 'capacitor://localhost', 'http://localhost']) {
      assert.ok(origins.includes(o), o + ' must be allowed');
    }
  });

  it('keeps the current site first — emails link to the first entry', () => {
    assert.equal(origins[0], 'https://kidemy-app.netlify.app');
  });

  it('no function declares its own copy of the list', () => {
    for (const f of fs.readdirSync(FUNCTIONS).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(FUNCTIONS, f), 'utf8');
      assert.ok(!/ALLOWED_ORIGINS\s*=\s*\[/.test(src), f + ' declares its own ALLOWED_ORIGINS');
    }
  });
});
