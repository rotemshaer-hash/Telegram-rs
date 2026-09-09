// Which database a given host talks to.
//
// This is the rule that decides whether a page writes to real users' data or
// to the staging instance, and it is asymmetric on purpose: an unrecognised
// host gets production. A preview wrongly talking to production is the bug we
// just fixed; a real user wrongly talking to staging looks to them like their
// account vanished, which is far worse and not something they can undo.
//
// The case that would have been an actual outage is `capacitor://localhost`:
// the packaged mobile app's hostname is exactly "localhost", so without the
// protocol check every phone user would have been routed to staging.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', '..', 'index.html');

function loadRule() {
  const src = fs.readFileSync(INDEX, 'utf8');
  const fn = src.match(/function _isStagingHost\(\)\{[\s\S]*?\n\}/);
  if (!fn) throw new Error('_isStagingHost not found in index.html');
  return new Function('location', `${fn[0]}; return _isStagingHost();`);
}

const PRODUCTION = [
  ['https:', 'kidemy-app.netlify.app', 'the production site'],
  ['capacitor:', 'localhost', 'the packaged mobile app'],
  ['ionic:', 'localhost', 'the packaged app under the ionic scheme'],
  ['file:', '', 'a file:// url'],
  ['https:', 'drushe.co.il', 'a custom domain we may add later'],
  ['https:', 'evil--kidemy-app.example.com', 'a lookalike host that is not netlify'],
  ['https:', 'kidemy-app.netlify.app.attacker.com', 'a suffix-spoofing host'],
];

const STAGING = [
  ['https:', 'deploy-preview-141--kidemy-app.netlify.app', 'a pull-request preview'],
  ['https:', 'claude-staging--kidemy-app.netlify.app', 'a branch deploy'],
  ['http:', 'localhost', 'local development'],
  ['http:', '127.0.0.1', 'local development by ip'],
];

test.describe('which database a host talks to', () => {
  for (const [protocol, hostname, label] of PRODUCTION) {
    test(`${label} uses production`, () => {
      expect(loadRule()({ protocol, hostname })).toBe(false);
    });
  }

  for (const [protocol, hostname, label] of STAGING) {
    test(`${label} uses staging`, () => {
      expect(loadRule()({ protocol, hostname })).toBe(true);
    });
  }

  test('anything unreadable falls back to production, never staging', () => {
    const rule = loadRule();
    expect(rule(null)).toBe(false);
    expect(rule({})).toBe(false);
    expect(rule({ protocol: 'https:' })).toBe(false);
  });

  test('the two database URLs are different, or the switch is decorative', () => {
    const src = fs.readFileSync(INDEX, 'utf8');
    const prod = src.match(/const PROD_DB_URL = "([^"]+)"/)[1];
    const staging = src.match(/const STAGING_DB_URL = "([^"]+)"/)[1];
    expect(prod).not.toBe(staging);
  });
});
