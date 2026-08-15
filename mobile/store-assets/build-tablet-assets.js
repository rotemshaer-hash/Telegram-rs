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
@font-face{font-family:'Rubik';font-weight:900;src:url(data:font/woff2;base64,${font('rubik/files/rubik-hebrew-900-normal.woff2')}) format('woff2');}`;

const GRAD = 'linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)';
const BASE = `<meta charset="utf8"><style>*{margin:0;padding:0;box-sizing:border-box}${FONTS}
body{font-family:'Heebo',sans-serif;direction:rtl;-webkit-font-smoothing:antialiased}</style>`;

// Tablet shell: bigger canvas, app shown as a centered floating card with margins.
function shot(caption, sub, bodyHtml){
  return `${BASE}
  <div style="width:1600px;height:2560px;background:${GRAD};display:flex;flex-direction:column;
  align-items:center;padding:120px 90px 0;position:relative;overflow:hidden">
    <div style="position:absolute;top:120px;left:120px;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.10),transparent 70%)"></div>
    <div style="text-align:center;color:#fff;margin-bottom:70px;position:relative;z-index:1">
      <div style="font-family:'Rubik';font-weight:900;font-size:104px;line-height:1.08">${caption}</div>
      <div style="font-size:46px;font-weight:500;margin-top:22px;color:rgba(255,255,255,.9)">${sub}</div>
    </div>
    <div style="width:100%;max-width:1040px;background:#F7FAF9;border-radius:56px;
    box-shadow:0 40px 100px rgba(0,0,0,.4);overflow:hidden;display:flex;flex-direction:column;
    flex:1;margin-bottom:150px;position:relative;z-index:1">
      <div style="background:${GRAD};color:#fff;padding:44px 52px;display:flex;align-items:center;
      justify-content:space-between">
        <div style="display:flex;align-items:center;gap:20px">
          <img src="data:image/png;base64,${ICON}" style="width:80px;height:80px;border-radius:20px">
          <span style="font-family:'Rubik';font-weight:900;font-size:52px">Drushe</span>
        </div>
        <span style="font-size:44px">☰</span>
      </div>
      <div style="padding:56px 56px 40px;flex:1;display:flex;flex-direction:column;justify-content:center">${bodyHtml}</div>
      <div style="border-top:1px solid #E6EDEB;background:#fff;display:flex;justify-content:space-around;
      padding:28px 24px 40px">
        ${[['🏠','בית',1],['🔍','חיפוש',0],['💬','הודעות',0],['👤','פרופיל',0]].map(([ic,lb,on])=>
          `<div style="text-align:center;color:${on?'#0e7a72':'#9AA7A4'}"><div style="font-size:50px">${ic}</div>
          <div style="font-size:30px;font-weight:${on?800:600};margin-top:6px">${lb}</div></div>`).join('')}
      </div>
    </div>
  </div>`;
}

const card = (inner)=>`<div style="background:#fff;border:1px solid #E6EDEB;border-radius:34px;
padding:38px 40px;box-shadow:0 8px 26px rgba(15,26,31,.05)">${inner}</div>`;

const teacher = (name,subj,city,price,rating,emoji,color)=>`
<div style="display:flex;align-items:center;gap:28px;padding:10px 0">
  <div style="width:108px;height:108px;border-radius:26px;background:${color};display:flex;
  align-items:center;justify-content:center;font-size:54px;flex-shrink:0">${emoji}</div>
  <div style="flex:1">
    <div style="font-size:44px;font-weight:800;color:#0F1A1F">${name}</div>
    <div style="font-size:34px;color:#5B6B68;margin-top:4px">${subj} · ${city}</div>
    <div style="font-size:33px;margin-top:8px;color:#0e7a72;font-weight:700">⭐ ${rating}　·　₪${price}/שיעור</div>
  </div>
</div>`;

const screen1 = shot('מצא את המורה המושלם','לפי נושא, מחיר, דירוג ומרחק',`
  <div style="background:#fff;border:1px solid #E6EDEB;border-radius:26px;padding:30px 34px;
  font-size:38px;color:#8A9995;display:flex;align-items:center;gap:16px;margin-bottom:32px">🔍 חפש מורה, נושא או עיר...</div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:36px">
    ${['מתמטיקה','גיטרה','אנגלית','קוד','כדורגל','ציור'].map((c,i)=>`<span style="background:${i===0?'#0e7a72':'#EAF3F1'};color:${i===0?'#fff':'#0e7a72'};padding:14px 30px;border-radius:999px;font-size:34px;font-weight:700">${c}</span>`).join('')}
  </div>
  <div style="display:flex;flex-direction:column;gap:24px">
    ${card(teacher('נטע ש׳','מתמטיקה','תל אביב','60','4.9','🧮','#EAF3F1'))}
    ${card(teacher('איתי ל׳','גיטרה','חיפה','50','5.0','🎸','#F3EAFB'))}
    ${card(teacher('מאיה כ׳','אנגלית','ירושלים','55','4.8','🇬🇧','#EAF3F1'))}
  </div>`);

const safeItem = (t)=>`<div style="display:flex;align-items:flex-start;gap:22px;padding:22px 0;border-bottom:1px solid #EEF3F2">
  <div style="width:64px;height:64px;border-radius:50%;background:#EAF7F0;display:flex;align-items:center;
  justify-content:center;font-size:36px;flex-shrink:0">✓</div>
  <div style="font-size:38px;font-weight:600;color:#22332F;padding-top:8px">${t}</div></div>`;

const screen2 = shot('בפיקוח הורים מלא','ההורים במרכז — בכל שלב',`
  ${card(`<div style="text-align:center">
    <div style="font-size:70px">🛡️</div>
    <div style="font-size:50px;font-weight:900;color:#0F1A1F;margin-top:14px">בטיחות לפני הכל</div>
    <div style="font-size:35px;color:#5B6B68;margin-top:12px;line-height:1.5">כל קטין נרשם רק באישור הורה,<br>וכל מורה עובר אימות ידני של הצוות</div>
  </div>`)}
  <div style="height:32px"></div>
  ${card(`
    ${safeItem('אישור הורה מפורש לכל הרשמה של קטין')}
    ${safeItem('אימות זהות וגיל ידני לכל מורה')}
    ${safeItem('שיעור ניסיון ראשון קצר ומפוקח')}
    ${safeItem('דוח שבועי אוטומטי להורים במייל')}
    ${safeItem('כפתור דיווח בכל צ׳אט — טיפול תוך 24 שעות')}
  `)}`);

const screen3 = shot('יש לך כישרון? תלמד אותו','אתה קובע מחיר, זמינות ותנאים',`
  ${card(`<div style="display:flex;align-items:center;justify-content:space-between">
    <div><div style="font-size:36px;color:#5B6B68">הרווחת החודש</div>
    <div style="font-family:'Rubik';font-weight:900;font-size:82px;color:#0e7a72">₪1,840</div></div>
    <div style="font-size:88px">💸</div>
  </div>`)}
  <div style="height:30px"></div>
  ${card(`<div style="font-size:42px;font-weight:800;color:#0F1A1F;margin-bottom:24px">הגדרות המורה</div>
    <div style="display:flex;justify-content:space-between;font-size:37px;padding:18px 0;border-bottom:1px solid #EEF3F2"><span style="color:#5B6B68">נושא</span><span style="font-weight:700">מתמטיקה 📐</span></div>
    <div style="display:flex;justify-content:space-between;font-size:37px;padding:18px 0;border-bottom:1px solid #EEF3F2"><span style="color:#5B6B68">מחיר לשיעור</span><span style="font-weight:700;color:#0e7a72">₪60</span></div>
    <div style="display:flex;justify-content:space-between;font-size:37px;padding:18px 0"><span style="color:#5B6B68">זמינות</span><span style="font-weight:700">א׳-ה׳ · 16:00–20:00</span></div>`)}
  <div style="height:30px"></div>
  <div style="background:${GRAD};border-radius:30px;padding:34px;text-align:center;color:#fff;font-size:42px;font-weight:800">התחל ללמד — ההרשמה בחינם</div>`);

const assets = [
  ['tablet-1-browse.png', screen1],
  ['tablet-2-safety.png', screen2],
  ['tablet-3-earn.png', screen3],
];

(async()=>{
  const browser = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  for(const [name,html] of assets){
    const page = await browser.newPage({viewport:{width:1600,height:2560},deviceScaleFactor:1});
    await page.setContent(html,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({path:path.join(DIR,name),clip:{x:0,y:0,width:1600,height:2560}});
    await page.close();
    console.log('✓',name);
  }
  await browser.close();
})();
