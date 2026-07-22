// Serves the real index.html for E2E smoke tests, with the Firebase/EmailJS
// CDN <script> tags swapped for local mocks (tests/mocks/*.js) so the suite
// never touches production Firebase or costs a real EmailJS send.
//
// Tied to the exact CDN tags currently in index.html on purpose: if someone
// bumps the SDK version or changes these tags, this throws instead of
// silently serving the real (unmocked) SDK to the test run.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || 4173;

const ORIGINAL_TAGS = [
  '<script src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js"></script>',
  '<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>',
  '<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js"></script>',
  '<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>',
  '<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js"></script>',
  '<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-analytics-compat.js"></script>',
];

function buildTestHtml() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const tag of ORIGINAL_TAGS) {
    if (!html.includes(tag)) {
      throw new Error(
        'tests/serve-test-app.js: expected CDN <script> tag not found in index.html ' +
        '(SDK version or tag changed?) — update ORIGINAL_TAGS. Missing: ' + tag
      );
    }
    html = html.replace(tag, '');
  }
  const stubTags =
    '<script src="/__test-mocks__/emailjs-stub.js"></script>\n' +
    '<script src="/__test-mocks__/firebase-stub.js"></script>';
  html = html.replace('<!-- Firebase SDKs -->', '<!-- Firebase SDKs (mocked for tests) -->\n' + stubTags);
  return html;
}

const MIME = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath === '/' || urlPath === '/index.html') {
    try {
      const html = buildTestHtml();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(e.message || e));
    }
    return;
  }

  if (urlPath.startsWith('/__test-mocks__/')) {
    const file = path.join(__dirname, 'mocks', urlPath.replace('/__test-mocks__/', ''));
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }

  const filePath = path.join(ROOT, urlPath);
  if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log('Test server listening on http://localhost:' + PORT);
});
