// The ids in inline handlers are database keys another user can choose, and a key
// may contain ' ( ) ; — so go('${id}') without jsAttrEscape runs code for whoever
// clicks. scripts/check-handler-escapes.js finds them; this pins that it catches
// each shape, accepts the wrapped ones, and that index.html is clean (QA 29.10.2026).

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scan } = require('../../scripts/check-handler-escapes.js');

describe('inline handler escapes', () => {
  const caught = [
    ['a plain id between single quotes', `<button onclick="go('\${x.id}')">`],
    ['a double-quoted JS string in a single-quoted attribute', `<button onclick='f("\${x}")'>`],
    ['an id inside a template nested in a handler expression', '<b onclick="${ok?`S.r=\'${t.id}\';render()`:`go(1)`}">'],
    ['an id in the middle of a string', `<b onclick="f('a-\${x}-b')">`],
    ['escapeHtml inside a JS string (the browser decodes &#39; back to a quote)', `<b onclick="f('\${escapeHtml(name)}')">`],
  ];
  for (const [name, html] of caught) {
    it('catches ' + name, () => assert.equal(scan(html).length > 0, true, html));
  }

  const accepted = [
    ['a jsAttrEscape-wrapped id', `<button onclick="go('\${jsAttrEscape(x.id)}')">`],
    ['a number in code position', `<b onclick="f(\${i})">`],
    ['a quote that is not in an event handler', `<b data-x="'\${x}'">`],
    ['JSON passed through escapeHtml', `<b onclick="f(\${escapeHtml(JSON.stringify(x))})">`],
  ];
  for (const [name, html] of accepted) {
    it('accepts ' + name, () => assert.equal(scan(html).length, 0, html));
  }

  it('index.html has no unescaped interpolation inside an inline handler string', () => {
    const text = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const found = scan(text);
    assert.deepEqual(found.slice(0, 5).map((f) => f.line + ': ${' + f.expr + '}'), []);
  });
});
