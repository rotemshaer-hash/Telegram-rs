// Drushe — עיצוב מיילים. הגדרה אחת, משותפת לשרת (netlify/lib/emailjs.js) ולדפדפן (sendEmail ב-index.html).
//
// למה: כל מייל שיצא מ-Drushe — אישור הורה, אישור קבוצה, איפוס סיסמה, התראות — היה טקסט גולמי בתבנית גנרית. הורה שמקבל
// בקשה לאשר לילד שלו להיפגש עם נער בפארק, ומקבל אותה בלי שום סימן שמדובר ב-Drushe, לא יודע אם זה אמיתי; ומייל שנראה
// כמו פישינג מלמד אנשים להתעלם מהמיילים האמיתיים. מייל שנראה כמו האפליקציה — כותרת המותג, כרטיס בצבעי האפליקציה, כפתור
// אחד ברור — הוא גם סימן זיהוי.
//
// איך: לא כתבתי מחדש אף נוסח. המיילים הקיימים כתובים כטקסט מובנה (פסקאות בשורה ריקה, שורות פרטים שמתחילות באימוג'י,
// קישור בשורה משלו, ‎**מודגש**‎, חתימה). המעצב קורא את המבנה הזה ובונה ממנו HTML. הטקסט המקורי נשלח גם הוא (message),
// כך שתבנית שעוד לא עודכנה ב-EmailJS ממשיכה להציג אותו כמו קודם.
//
// צבעים: רק מבלוק הטוקנים של index.html. כותרת המותג — הגרדיאנט המוגן; כרטיס — ‎#F0F9FF‎ מהגרדיאנט של המשטח, על רקע ‎#EEF2FF‎;
// כפתור — --grad-main; כותרות ‎#0F1A1F‎, גוף ‎#475569‎, משני ‎#64748B‎. אין משטח לבן. לקוחות דואר לא תומכים תמיד בגרדיאנט,
// ולכן לכל גרדיאנט יש צבע אחיד חלופי.
//
// אבטחה: כל טקסט עובר escape לפני שהוא נכנס ל-HTML; קישורים — רק http/https.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DrusheEmail = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var C = {
    page: '#EEF2FF', card: '#F0F9FF', fact: '#ECFEFF', accent: '#14B8A6', accent2: '#06B6D4', brandMid: '#0e7a72',
    title: '#0F1A1F', body: '#475569', muted: '#64748B', link: '#0e7a72',
    headGrad: 'linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)',
    btnGrad: 'linear-gradient(135deg,#14B8A6,#06B6D4)',
  };
  var FONT = "Arial,'Segoe UI',Helvetica,sans-serif";
  var TAGLINE = 'בני נוער מלמדים ילדים — באישור הורים';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // אחרי escape: ‎**מודגש**‎ וקישורים. הקישור נחתך לפני פיסוק שבסוף משפט.
  function inline(escaped) {
    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:' + C.title + '">$1</strong>')
      .replace(/(https?:\/\/[^\s<]+)/g, function (m) {
        var tail = ''; var url = m;
        var t = url.match(/[.,;:!?)־]+$/);
        if (t) { tail = t[0]; url = url.slice(0, -tail.length); }
        return '<a href="' + url + '" style="color:' + C.link + ';font-weight:700;word-break:break-all">' + url + '</a>' + tail;
      });
  }
  var URL_ALONE = /^https?:\/\/\S+$/;
  function buttonLabel(url, override) {
    if (override) return override;
    if (/[?&](groupConsent|consent)=/.test(url)) return 'לצפייה ולאישור';
    if (/[?&]parentView=/.test(url)) return 'לצפייה בפעילות';
    return 'פתיחה ב-Drushe';
  }
  function button(url, label) {
    var u = esc(url);
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td align="center">' +
      '<a href="' + u + '" style="display:block;background:' + C.accent + ';background-image:' + C.btnGrad + ';color:#ffffff;text-decoration:none;font-weight:900;font-size:16px;' +
      'line-height:1.2;padding:15px 22px;border-radius:50px;text-align:center;font-family:' + FONT + '">' + esc(label) + '</a></td></tr></table>';
  }
  function para(htmlInner, extra) {
    return '<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:' + C.body + ';text-align:right;font-family:' + FONT + ';' + (extra || '') + '">' + htmlInner + '</p>';
  }
  // שורה שמתחילה באימוג'י או בסימן, ואחריו רווח: "📅 יום שני"
  var FACT_LINE = /^[^\s\p{L}\p{N}*"'(\[]{1,4}\s+\S/u;

  function render(opts) {
    opts = opts || {};
    var subject = String(opts.subject || '');
    var text = String(opts.text || '').replace(/\r\n/g, '\n').trim();
    var site = String(opts.siteUrl || '').replace(/\/+$/, '');
    var blocks = text.split(/\n{2,}/).map(function (b) { return b.trim(); }).filter(Boolean);

    var firstPlain = '';
    var out = [];
    blocks.forEach(function (block, idx) {
      var lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      // חתימה: "– צוות Drushe"
      if (lines.length === 1 && /^[–—-]\s*\S/.test(lines[0]) && idx === blocks.length - 1) {
        out.push('<p style="margin:22px 0 0;font-size:14px;color:' + C.muted + ';text-align:right;font-family:' + FONT + '">&#8207;' + inline(esc(lines[0])) + '</p>');
        return;
      }
      // בלוק של שורות פרטים
      if (lines.length >= 2 && lines.every(function (l) { return FACT_LINE.test(l); })) {
        out.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:' + C.fact + ';border-right:4px solid ' + C.accent +
          ';border-radius:12px;padding:14px 16px;font-size:15px;line-height:2;color:' + C.title + ';text-align:right;font-family:' + FONT + '">' +
          lines.map(function (l) { return inline(esc(l)); }).join('<br>') + '</td></tr></table>');
        return;
      }
      // פסקה רגילה, עם כפתור לכל קישור שעומד בשורה משלו
      var buf = [];
      function flush() { if (buf.length) { out.push(para(buf.map(function (l) { return inline(esc(l)); }).join('<br>'))); buf = []; } }
      lines.forEach(function (l) {
        if (URL_ALONE.test(l)) { flush(); out.push(button(l, buttonLabel(l, opts.buttonLabel))); }
        else buf.push(l);
      });
      flush();
      if (!firstPlain && !/^שלום/.test(lines[0])) firstPlain = lines.join(' ').replace(/\*\*/g, '');
    });

    var pre = esc(firstPlain.slice(0, 110));
    var legal = site
      ? '<a href="' + esc(site) + '/terms.html" style="color:' + C.muted + '">תנאי שימוש</a> · <a href="' + esc(site) + '/privacy.html" style="color:' + C.muted + '">פרטיות</a> · <a href="' + esc(site) + '/child-safety.html" style="color:' + C.muted + '">בטיחות ילדים</a>'
      : '';

    return '<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light"><title>' + esc(subject) + '</title></head>' +
      '<body style="margin:0;padding:0;background:' + C.page + '">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:' + C.page + '">' + pre + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="' + C.page + '" style="background:' + C.page + '"><tr><td align="center" style="padding:20px 12px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:560px">' +
      '<tr><td align="center" bgcolor="' + C.brandMid + '" style="background:' + C.brandMid + ';background-image:' + C.headGrad + ';border-radius:20px 20px 0 0;padding:26px 24px 22px">' +
      '<div style="font-family:' + FONT + ';font-size:30px;font-weight:900;color:#ffffff;letter-spacing:.5px;line-height:1.1">Drushe</div>' +
      '<div style="font-family:' + FONT + ';font-size:13px;color:#ECFEFF;margin-top:6px">' + TAGLINE + '</div></td></tr>' +
      '<tr><td bgcolor="' + C.card + '" style="background:' + C.card + ';border-radius:0 0 20px 20px;padding:26px 24px 22px;text-align:right">' +
      (subject ? '<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;color:' + C.title + ';text-align:right;font-family:' + FONT + '">' + esc(subject) + '</h1>' : '') +
      out.join('') +
      '</td></tr>' +
      '<tr><td style="padding:16px 8px 4px;text-align:center;font-family:' + FONT + ';font-size:12px;line-height:1.7;color:' + C.muted + '">' +
      'מייל אוטומטי מ-Drushe — אין צורך להשיב אליו.' + (legal ? '<br>' + legal : '') + '</td></tr>' +
      '</table></td></tr></table></body></html>';
  }

  return { render: render, esc: esc };
});
