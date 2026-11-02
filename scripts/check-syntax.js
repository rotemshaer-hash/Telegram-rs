#!/usr/bin/env node
// Every inline <script> in index.html must parse. A single stray backtick (found 2.11.2026 after a line was
// removed from the middle of a template literal) turns the whole app into a blank page, and nothing in the other
// checks notices until a browser test runs.
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m; let n = 0; let bad = 0;
while ((m = re.exec(html))) {
  n++;
  const file = path.join(require('node:os').tmpdir(), `drushe-inline-${process.pid}-${n}.js`);
  fs.writeFileSync(file, m[1]);
  const r = require('node:child_process').spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  fs.unlinkSync(file);
  if (r.status !== 0) { bad++; console.error(`inline script #${n} does not parse:\n${r.stderr.split('\n').slice(0, 6).join('\n')}`); }
}
if (bad) process.exit(1);
console.log(`✅ ${n} inline scripts parse`);
