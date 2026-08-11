const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const b64 = f => fs.readFileSync(path.join(DIR, f)).toString('base64');
const font = f => b64(path.join('node_modules/@fontsource', f));

const ICON = fs.readFileSync(path.join(DIR, 'icon.b64'), 'utf8').trim();

const FONTS = `
@font-face{font-family:'Heebo';font-weight:400;src:url(data:font/woff2;base64,${font('heebo/files/heebo-hebrew-400-normal.woff2')}) format('woff2');}
@font-face{font-family:'Heebo';font-weight:500;src:url(data:font/woff2;base64,${font('heebo/files/heebo-hebrew-500-normal.woff2')}) format('woff2');}
@font-face{font-family:'Heebo';font-weight:700;src:url(data:font/woff2;base64,${font('heebo/files/heebo-hebrew-700-normal.woff2')}) format('woff2');}
@font-face{font-family:'Heebo';font-weight:800;src:url(data:font/woff2;base64,${font('heebo/files/heebo-hebrew-800-normal.woff2')}) format('woff2');}
@font-face{font-family:'Heebo';font-weight:900;src:url(data:font/woff2;base64,${font('heebo/files/heebo-hebrew-900-normal.woff2')}) format('woff2');}
@font-face{font-family:'Rubik';font-weight:700;src:url(data:font/woff2;base64,${font('rubik/files/rubik-hebrew-700-normal.woff2')}) format('woff2');}
@font-face{font-family:'Rubik';font-weight:900;src:url(data:font/woff2;base64,${font('rubik/files/rubik-hebrew-900-normal.woff2')}) format('woff2');}
`;

const GRAD = 'linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)';
const BASE = `<meta charset="utf8"><style>*{margin:0;padding:0;box-sizing:border-box}${FONTS}
body{font-family:'Heebo',sans-serif;direction:rtl;-webkit-font-smoothing:antialiased}</style>`;

// ---------- Feature graphic 1024x500 ----------
const feature = `${BASE}
<div style="width:1024px;height:500px;background:${GRAD};display:flex;align-items:center;
justify-content:center;gap:48px;position:relative;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 20%,rgba(255,255,255,.10),transparent 40%)"></div>
  <div style="text-align:right;color:#fff;z-index:1">
    <div style="font-family:'Rubik';font-weight:900;font-size:104px;letter-spacing:-2px;line-height:1">Drushe</div>
    <div style="font-family:'Rubik';font-weight:900;font-size:52px;margin-top:6px;color:#fff">ילדים מלמדים ילדים</div>
    <div style="font-size:28px;font-weight:500;margin-top:18px;color:rgba(255,255,255,.88)">שיעורים פרטיים בין ילדים · בפיקוח הורים מלא</div>
    <div style="display:inline-flex;gap:10px;margin-top:26px">
      <span style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);padding:8px 18px;border-radius:999px;font-size:22px;font-weight:700">🎓 למד</span>
      <span style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);padding:8px 18px;border-radius:999px;font-size:22px;font-weight:700">💸 הרווח</span>
      <span style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);padding:8px 18px;border-radius:999px;font-size:22px;font-weight:700">🛡️ בבטחה</span>
    </div>
  </div>
  <img src="data:image/png;base64,${ICON}" style="width:240px;height:240px;border-radius:52px;
  box-shadow:0 24px 60px rgba(0,0,0,.4);z-index:1">
</div>`;

// ---------- Screenshot shell ----------
function shot(caption, sub, bodyHtml, accent='#0e7a72'){
  return `${BASE}
  <div style="width:1080px;height:1920px;background:${GRAD};display:flex;flex-direction:column;
  align-items:center;padding:70px 60px 0">
    <div style="text-align:center;color:#fff;margin-bottom:44px">
      <div style="font-family:'Rubik';font-weight:900;font-size:74px;line-height:1.08">${caption}</div>
      <div style="font-size:34px;font-weight:500;margin-top:16px;color:rgba(255,255,255,.9)">${sub}</div>
    </div>
    <div style="flex:1;width:100%;max-width:900px;background:#F7FAF9;border-radius:52px 52px 0 0;
    box-shadow:0 -10px 60px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column">
      <div style="background:${GRAD};color:#fff;padding:34px 40px;display:flex;align-items:center;
      justify-content:space-between">
        <div style="display:flex;align-items:center;gap:16px">
          <img src="data:image/png;base64,${ICON}" style="width:64px;height:64px;border-radius:16px">
          <span style="font-family:'Rubik';font-weight:900;font-size:40px">Drushe</span>
        </div>
        <span style="font-size:34px">☰</span>
      </div>
      <div style="padding:44px 44px 30px;flex:1;display:flex;flex-direction:column;justify-content:center">${bodyHtml}</div>
      <div style="border-top:1px solid #E6EDEB;background:#fff;display:flex;justify-content:space-around;
      padding:22px 20px 30px">
        ${[['🏠','בית',1],['🔍','חיפוש',0],['💬','הודעות',0],['👤','פרופיל',0]].map(([ic,lb,on])=>
          `<div style="text-align:center;color:${on?'#0e7a72':'#9AA7A4'}"><div style="font-size:40px">${ic}</div>
          <div style="font-size:24px;font-weight:${on?800:600};margin-top:4px">${lb}</div></div>`).join('')}
      </div>
    </div>
  </div>`;
}

const card = (inner)=>`<div style="background:#fff;border:1px solid #E6EDEB;border-radius:28px;
padding:30px 32px;box-shadow:0 6px 20px rgba(15,26,31,.05)">${inner}</div>`;

// SCREEN 1 — browse teachers
const teacher = (name,subj,city,price,rating,emoji,color)=>`
<div style="display:flex;align-items:center;gap:22px;padding:8px 0">
  <div style="width:88px;height:88px;border-radius:22px;background:${color};display:flex;
  align-items:center;justify-content:center;font-size:44px;flex-shrink:0">${emoji}</div>
  <div style="flex:1">
    <div style="font-size:36px;font-weight:800;color:#0F1A1F">${name}</div>
    <div style="font-size:28px;color:#5B6B68;margin-top:2px">${subj} · ${city}</div>
    <div style="font-size:27px;margin-top:6px;color:#0e7a72;font-weight:700">⭐ ${rating}　·　₪${price}/שיעור</div>
  </div>
</div>`;

const screen1 = shot('מצא את המורה המושלם','לפי נושא, מחיר, דירוג ומרחק',`
  <div style="background:#fff;border:1px solid #E6EDEB;border-radius:22px;padding:24px 28px;
  font-size:30px;color:#8A9995;display:flex;align-items:center;gap:14px;margin-bottom:26px">
    🔍 חפש מורה, נושא או עיר...
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:30px">
    ${['מתמטיקה','גיטרה','אנגלית','קוד','כדורגל','ציור'].map((c,i)=>`<span style="background:${i===0?'#0e7a72':'#EAF3F1'};color:${i===0?'#fff':'#0e7a72'};padding:12px 24px;border-radius:999px;font-size:28px;font-weight:700">${c}</span>`).join('')}
  </div>
  <div style="display:flex;flex-direction:column;gap:20px">
    ${card(teacher('נטע ש׳','מתמטיקה','תל אביב','60','4.9','🧮','#EAF3F1'))}
    ${card(teacher('איתי ל׳','גיטרה','חיפה','50','5.0','🎸','#F3EAFB'))}
    ${card(teacher('מאיה כ׳','אנגלית','ירושלים','55','4.8','🇬🇧','#EAF3F1'))}
    ${card(teacher('יונתן ד׳','קוד ומחשבים','רמת גן','70','4.9','💻','#F3EAFB'))}
  </div>`);

// SCREEN 2 — safety / parents
const safeItem = (t)=>`<div style="display:flex;align-items:flex-start;gap:18px;padding:18px 0;border-bottom:1px solid #EEF3F2">
  <div style="width:52px;height:52px;border-radius:50%;background:#EAF7F0;display:flex;align-items:center;
  justify-content:center;font-size:30px;flex-shrink:0">✓</div>
  <div style="font-size:32px;font-weight:600;color:#22332F;padding-top:6px">${t}</div></div>`;

const screen2 = shot('בפיקוח הורים מלא','ההורים במרכז — בכל שלב',`
  ${card(`<div style="text-align:center">
    <div style="font-size:56px">🛡️</div>
    <div style="font-size:40px;font-weight:900;color:#0F1A1F;margin-top:10px">בטיחות לפני הכל</div>
    <div style="font-size:29px;color:#5B6B68;margin-top:8px;line-height:1.5">כל קטין נרשם רק באישור הורה,<br>וכל מורה עובר אימות ידני של הצוות</div>
  </div>`)}
  <div style="height:26px"></div>
  ${card(`
    ${safeItem('אישור הורה מפורש לכל הרשמה של קטין')}
    ${safeItem('אימות זהות וגיל ידני לכל מורה')}
    ${safeItem('שיעור ניסיון ראשון קצר ומפוקח')}
    ${safeItem('דוח שבועי אוטומטי להורים במייל')}
    ${safeItem('כפתור דיווח בכל צ׳אט — טיפול תוך 24 שעות')}
  `)}`);

// SCREEN 3 — teach & earn
const screen3 = shot('יש לך כישרון? תלמד אותו','אתה קובע מחיר, זמינות ותנאים',`
  ${card(`<div style="display:flex;align-items:center;justify-content:space-between">
    <div><div style="font-size:30px;color:#5B6B68">הרווחת החודש</div>
    <div style="font-family:'Rubik';font-weight:900;font-size:64px;color:#0e7a72">₪1,840</div></div>
    <div style="font-size:70px">💸</div>
  </div>`)}
  <div style="height:24px"></div>
  ${card(`<div style="font-size:34px;font-weight:800;color:#0F1A1F;margin-bottom:18px">הגדרות המורה</div>
    <div style="display:flex;justify-content:space-between;font-size:31px;padding:14px 0;border-bottom:1px solid #EEF3F2"><span style="color:#5B6B68">נושא</span><span style="font-weight:700">מתמטיקה 📐</span></div>
    <div style="display:flex;justify-content:space-between;font-size:31px;padding:14px 0;border-bottom:1px solid #EEF3F2"><span style="color:#5B6B68">מחיר לשיעור</span><span style="font-weight:700;color:#0e7a72">₪60</span></div>
    <div style="display:flex;justify-content:space-between;font-size:31px;padding:14px 0"><span style="color:#5B6B68">זמינות</span><span style="font-weight:700">א׳-ה׳ · 16:00–20:00</span></div>
  `)}
  <div style="height:24px"></div>
  <div style="background:${GRAD};border-radius:24px;padding:28px;text-align:center;color:#fff;
  font-size:34px;font-weight:800">התחל ללמד — ההרשמה בחינם</div>`);

const assets = [
  ['feature-graphic.png', feature, 1024, 500],
  ['screenshot-1-browse.png', screen1, 1080, 1920],
  ['screenshot-2-safety.png', screen2, 1080, 1920],
  ['screenshot-3-earn.png', screen3, 1080, 1920],
];

(async ()=>{
  const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  for(const [name,html,w,h] of assets){
    const page = await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
    await page.setContent(html,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({path:path.join(DIR,name),clip:{x:0,y:0,width:w,height:h}});
    await page.close();
    console.log('✓',name,`${w}x${h}`);
  }
  await browser.close();
})();
