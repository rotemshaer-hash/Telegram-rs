// email-design.js: a Drushe email looks like Drushe, and nothing a user typed can become markup.
//
// Every email used to be raw text in a generic template. A parent asked to approve a child's meetup with a stranger
// from a bare, unbranded message cannot tell it from phishing. The designer reads the structure of the existing texts
// (paragraphs, fact lines, a link on its own line, **bold**, a sign-off) and builds the HTML — it rewrites no copy.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render, esc } = require('../../email-design.js');

const URL64 = 'https://drushe.com/?groupConsent=' + 'a'.repeat(64);
const SAMPLE = `שלום רונית,\n\nדנה ביקש/ה להצטרף לקבוצה ב-Drushe:\n\n📌 שחמט בפארק\n👤 מוביל/ה: נועם\n📅 יום שני בשעה 17:00\n\n**חלק מהקבוצות נפגשות פיזית.** הילד לא יתקבל בלי אישורכם.\n\nלפרטים ולאישור:\n${URL64}\n\nבסכנה מיידית — משטרה 100.\n\n– צוות Drushe`;
const html = render({ subject: 'נדרש אישורך — דנה ביקש/ה להצטרף', text: SAMPLE, siteUrl: 'https://drushe.com' });

describe('email-design: it looks like Drushe', () => {
  it('is right-to-left Hebrew, with the brand header and the protected gradient', () => {
    assert.match(html, /<html dir="rtl" lang="he">/);
    assert.match(html, />Drushe</);
    assert.ok(html.includes('linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)'));
    assert.ok(html.includes('bgcolor="#0e7a72"'), 'a solid fallback for clients that drop gradients');
  });

  it('uses the app’s own surfaces — never a white one', () => {
    assert.ok(html.includes('#F0F9FF') && html.includes('#EEF2FF') && html.includes('#ECFEFF'));
    assert.ok(!/background(-color)?:\s*#fff(fff)?\b/i.test(html), 'no white background');
    assert.ok(!/bgcolor="#fff(fff)?"/i.test(html));
  });

  it('turns the link on its own line into one clear button with the right label', () => {
    assert.equal((html.match(/<a href="https:\/\/drushe\.com\/\?groupConsent=/g) || []).length, 1);
    assert.match(html, /linear-gradient\(135deg,#14B8A6,#06B6D4\)/);
    assert.match(html, />לצפייה ולאישור</);
    assert.match(render({ subject: 's', text: 'a\n\nhttps://drushe.com/?parentView=abc' }), />לצפייה בפעילות</);
    assert.match(render({ subject: 's', text: 'a\n\nhttps://drushe.com' }), />פתיחה ב-Drushe</);
  });

  it('shows the fact lines as one card, keeps bold, and sets the sign-off apart', () => {
    assert.match(html, /border-right:4px solid #14B8A6/);
    assert.ok(html.includes('📅 יום שני בשעה 17:00') && html.includes('📌 שחמט בפארק'));
    assert.match(html, /<strong style="color:#0F1A1F">חלק מהקבוצות נפגשות פיזית\.<\/strong>/);
    assert.match(html, /margin:22px 0 0[^>]*>&#8207;– צוות Drushe</);   // the invisible direction mark keeps the dash on the right in RTL
  });

  it('has a footer with the legal pages and a preheader taken from the first real paragraph', () => {
    assert.match(html, /href="https:\/\/drushe\.com\/terms\.html"/);
    assert.match(html, /href="https:\/\/drushe\.com\/privacy\.html"/);
    assert.match(html, /href="https:\/\/drushe\.com\/child-safety\.html"/);
    assert.match(html, /display:none;max-height:0[^>]*>דנה ביקש\/ה להצטרף/);
  });

  it('survives text with no structure at all', () => {
    const h = render({ subject: 'x', text: 'שורה אחת' });
    assert.match(h, /שורה אחת/);
    assert.ok(render({}).includes('</html>'));
  });
});

describe('email-design: nothing typed by a user becomes markup', () => {
  it('escapes names, subjects and text', () => {
    const evil = '<img src=x onerror=alert(1)>"\'&';
    const h = render({ subject: evil, text: `שלום ${evil},\n\n${evil}\n\n📌 ${evil}\n📍 ${evil}\n\n– ${evil}`, siteUrl: 'https://drushe.com' });
    assert.ok(!h.includes('<img'), 'no raw tag');
    assert.ok(!/onerror=alert\(1\)>/.test(h.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), 'only the escaped form remains');
    assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  it('never makes a link out of a javascript: or data: URL', () => {
    const h = render({ subject: 's', text: 'a\n\njavascript:alert(1)\n\ndata:text/html,<script>1</script>\n\nhttps://ok.example/path' });
    assert.ok(!/href="javascript:/i.test(h) && !/href="data:/i.test(h));
    assert.equal((h.match(/href="https:\/\/ok\.example\/path"/g) || []).length, 1);
  });

  it('keeps a quote in a URL from breaking out of the href', () => {
    const h = render({ subject: 's', text: 'a\n\nhttps://x.example/?q="onmouseover="alert(1)' });
    assert.ok(!/href="[^"]*"\s*onmouseover=/i.test(h));
  });

  it('cuts sentence punctuation off an inline link', () => {
    const h = render({ subject: 's', text: 'היכנסו אל https://drushe.com/privacy.html.' });
    assert.match(h, /href="https:\/\/drushe\.com\/privacy\.html"[^>]*>https:\/\/drushe\.com\/privacy\.html<\/a>\./);
  });

  it('esc handles null and numbers', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(5), '5');
  });
});

describe('email-design: the same module serves the server and the browser', () => {
  it('the server sender puts both the raw text and the designed HTML in the template parameters', async () => {
    const calls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, text: async () => 'OK' }; };
    try {
      const { sendViaEmailJS } = require('../../netlify/lib/emailjs');
      await sendViaEmailJS('to@example.org', 'נושא', `שלום,\n\nפסקה.\n\n${URL64}\n\n– צוות Drushe`);
    } finally { global.fetch = realFetch; }
    const p = calls[0].body.template_params;
    assert.equal(p.message.startsWith('שלום,'), true, 'the raw text is untouched');
    assert.match(p.message_html, /^<!doctype html>/);
    assert.match(p.message_html, /https:\/\/drushe\.com\/terms\.html/, 'footer links use the primary domain');
    assert.equal(p.to_email, 'to@example.org');
  });

  it('index.html loads the module and sends message_html', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    assert.match(html, /<script src="\/email-design\.js"><\/script>/);
    assert.match(html, /message_html:_emailHtml\(subject,body\)/);
  });
});
