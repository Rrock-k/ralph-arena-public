const http = require('http');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PID_FILE = '/tmp/placeholder.pid';
// RA-137: Support custom title/message for blocked/building placeholder states
const TITLE = process.env.PLACEHOLDER_TITLE || 'Building your project';
const MESSAGE = process.env.PLACEHOLDER_MESSAGE || 'The AI agent is working on it. This page will auto-refresh.';

fs.writeFileSync(PID_FILE, String(process.pid));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="10">
<title>${TITLE}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{text-align:center;max-width:480px;padding:48px 32px}
h1{font-size:1.5rem;margin-bottom:12px;color:#3b82f6}
p{color:#94a3b8;margin-bottom:32px;font-size:0.95rem}
.dots{display:flex;gap:8px;justify-content:center}
.dot{width:12px;height:12px;border-radius:50%;background:#3b82f6;animation:pulse 1.4s ease-in-out infinite}
.dot:nth-child(2){animation-delay:0.2s}
.dot:nth-child(3){animation-delay:0.4s}
@keyframes pulse{0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
</style>
</head>
<body>
<div class="card">
<h1>${TITLE}</h1>
<p>${MESSAGE}</p>
<div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
</div>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"placeholder"}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[placeholder] listening on :${PORT} (pid ${process.pid})`);
});

process.on('SIGTERM', () => {
  try { fs.unlinkSync(PID_FILE); } catch {}
  server.close(() => process.exit(0));
});
