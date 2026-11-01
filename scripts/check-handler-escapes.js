#!/usr/bin/env node
// Every ${...} that lands INSIDE A JS STRING in an inline event handler
// (onclick="go('${id}')") must go through jsAttrEscape (or escapeHtml/JSON.stringify).
//
// Why this is a rule and not a style: the ids in those handlers are database keys
// or fields another user wrote. A key may contain ' ( ) ; < ! - (RTDB forbids only
// . # $ / [ ]), so  go('x');alert(1);('  closes the string and runs. QA found this
// in the booking screens (fixed 29.10.2026) and, when checked, in the groups, posts,
// questions, videos and admin screens as well. The check exists so it cannot come
// back one screen at a time.
//
//   node scripts/check-handler-escapes.js          report; exit 1 if anything is unwrapped
//   node scripts/check-handler-escapes.js --fix    wrap them in jsAttrEscape in place
//
// It reads one line at a time and understands: an on<event>= attribute opened with
// " or ', the JS string quotes inside it, and ${...} blocks (brace-balanced).
// Handlers that span lines are not seen — none exist today.

const fs = require('node:fs');
const path = require('node:path');

// Inside a JS string only jsAttrEscape is enough. escapeHtml turns ' into &#39;, which the browser decodes back
// to ' before the handler runs — so escapeHtml(name) in '${...}' still closes the string (found 1.11.2026).
const SAFE_CALL = /jsAttrEscape\(/;

// Inside handler code (the text between the attribute quotes, or the body of a nested template
// literal that builds such code) find every ${...} that sits inside a JS string and is not wrapped.
// `text` is scanned from `i`; when `attrQuote` is set the scan stops at that quote and returns the index.
function walk(text, i, base, attrQuote, found) {
  let jsQuote = null;
  while (i < text.length) {
    if (text.startsWith('${', i)) {
      const j = closeBrace(text, i + 2);
      const expr = text.slice(i + 2, j - 1);
      if (jsQuote && !SAFE_CALL.test(expr)) found.push({ start: base + i, end: base + j, expr });
      nestedTemplates(expr, base + i + 2, found); // handler code built by a template inside the expression
      i = j;
      continue;
    }
    const c = text[i];
    if (attrQuote && c === attrQuote) return i + 1;
    if ((c === "'" || c === '"') && text[i - 1] !== '\\') {
      if (jsQuote === null) jsQuote = c;
      else if (jsQuote === c) jsQuote = null;
    }
    i++;
  }
  return i;
}

// index just after the } that closes a ${ whose content starts at i
function closeBrace(text, i) {
  let depth = 1;
  let str = null;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === str) str = null;
    } else if (c === "'" || c === '"' || c === '`') str = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return i;
}

// look for template literals inside a JS expression; their bodies are handler code too
function nestedTemplates(expr, base, found) {
  let i = 0;
  let str = null;
  while (i < expr.length) {
    const c = expr[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === str) str = null;
      i++;
    } else if (c === "'" || c === '"') { str = c; i++; }
    else if (c === '`') {
      let j = i + 1;
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '\\') j++;
        else if (expr.startsWith('${', j)) { j = closeBrace(expr, j + 2); continue; }
        j++;
      }
      walk(expr.slice(i + 1, j), 0, base + i + 1, null, found);
      i = j + 1;
    } else i++;
  }
}

function scanLine(line) {
  const found = [];
  let i = 0;
  while (i < line.length) {
    const m = /^on[a-z]{3,}=(["'])/.exec(line.slice(i));
    const prev = i === 0 ? ' ' : line[i - 1];
    if (m && /[\s"'<>`]/.test(prev)) {
      i = walk(line, i + m[0].length, 0, m[1], found);
      continue;
    }
    i++;
  }
  return found;
}

function scan(text) {
  const findings = [];
  text.split('\n').forEach((line, n) => {
    for (const f of scanLine(line)) findings.push({ line: n + 1, ...f });
  });
  return findings;
}

function fix(text) {
  return text.split('\n').map((line) => {
    const fs_ = scanLine(line);
    for (let k = fs_.length - 1; k >= 0; k--) {
      const f = fs_[k];
      line = line.slice(0, f.start) + '${jsAttrEscape(' + f.expr + ')}' + line.slice(f.end);
    }
    return line;
  }).join('\n');
}

module.exports = { scan, scanLine, fix };

if (require.main === module) {
  const file = path.join(__dirname, '..', 'index.html');
  const text = fs.readFileSync(file, 'utf8');
  if (process.argv.includes('--fix')) {
    const out = fix(text);
    fs.writeFileSync(file, out);
    console.log('wrapped', scan(text).length, 'interpolations; remaining', scan(out).length);
    process.exit(0);
  }
  const findings = scan(text);
  if (findings.length) {
    console.error('❌ ' + findings.length + ' unwrapped ${...} inside a JS string of an inline handler (use jsAttrEscape):');
    for (const f of findings.slice(0, 30)) console.error('   index.html:' + f.line + '  ${' + f.expr.slice(0, 60) + '}');
    if (findings.length > 30) console.error('   … and ' + (findings.length - 30) + ' more');
    process.exit(1);
  }
  console.log('✅ every ${...} inside a JS string of an inline handler is escaped');
}
