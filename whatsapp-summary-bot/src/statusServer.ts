import { createServer } from 'http';
import { config } from './config.js';
import type { StatusState } from './types.js';

export const statusState: StatusState = {
  status: 'starting',
  matchedGroups: [],
  missingGroups: [],
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function renderPage(): string {
  const statusLabels: Record<string, string> = {
    starting: 'מתחיל...',
    waiting_for_pairing_code: 'מחכה שתזין את קוד הצימוד בוואטסאפ',
    connected: 'מחובר ✅',
    disconnected: 'מנותק, מנסה להתחבר מחדש...',
    error: 'שגיאה ⚠️',
  };

  const codeBlock = statusState.pairingCode
    ? `<div class="code">${escapeHtml(statusState.pairingCode)}</div>
       <p>בוואטסאפ: הגדרות ← מכשירים מקושרים ← קישור מכשיר ← קישור עם מספר טלפון במקום זאת ← הזן את הקוד הזה</p>`
    : '';

  const missingBlock = statusState.missingGroups.length
    ? `<div class="warn"><b>⚠️ קבוצות שלא נמצאו:</b><ul>${statusState.missingGroups
        .map((n) => `<li>${escapeHtml(n)}</li>`)
        .join('')}</ul><p>בדוק את הכתיב המדויק בקובץ ההגדרות של הקבוצות.</p></div>`
    : '';

  const matchedBlock = statusState.matchedGroups.length
    ? `<p><b>קבוצות שעוקבים אחריהן:</b> ${statusState.matchedGroups.map(escapeHtml).join(', ')}</p>`
    : '';

  const errorBlock = statusState.errorMessage
    ? `<div class="warn"><b>שגיאה:</b> ${escapeHtml(statusState.errorMessage)}</div>`
    : '';

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>סטטוס הבוט</title>
<style>
  body { font-family: system-ui, sans-serif; background:#0F1A1F; color:#EEF2FF; margin:0; padding:24px 16px; }
  .card { max-width:480px; margin:0 auto; background:#13222a; border-radius:16px; padding:24px; }
  h1 { font-size:20px; margin-top:0; }
  .status { font-size:18px; margin:12px 0; }
  .code { font-size:36px; font-weight:bold; letter-spacing:4px; text-align:center;
          background:#0e7a72; color:white; border-radius:12px; padding:16px; margin:16px 0; }
  .warn { background:#2a1a13; border-radius:12px; padding:12px; margin:16px 0; }
  p { line-height:1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>סטטוס הבוט</h1>
    <div class="status">${statusLabels[statusState.status] ?? statusState.status}</div>
    ${codeBlock}
    ${errorBlock}
    ${matchedBlock}
    ${missingBlock}
    ${statusState.lastSummaryAt ? `<p>סיכום אחרון נשלח: ${escapeHtml(statusState.lastSummaryAt)}</p>` : ''}
  </div>
</body>
</html>`;
}

export function startStatusServer(): void {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage());
  });
  server.listen(config.port, () => {
    console.log(`Status page listening on port ${config.port}`);
  });
}
