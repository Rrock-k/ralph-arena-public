/**
 * Dummy cycle — smoke test for the full pipeline.
 *
 * Creates a minimal app with a nice preview page,
 * starts it on :3000, commits, and signals completion.
 *
 * Usage:
 *   node /arena/cycles/dummy.js --work-dir /workspace
 */

import { execSync } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { scrubRunnerAuthEnv } from "../auth.js";

const args = process.argv.slice(2);
function getArg(name: string, def = ""): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const WORK_DIR = getArg("work-dir", "/workspace");
const PROJECT_ID = process.env.ARENA_PROJECT_ID || "unknown";
const PUSH_BRANCH = process.env.ARENA_PUSH_BRANCH || `arena/project-${PROJECT_ID}`;
const RESULT_FILE = join(WORK_DIR, ".arena", "result.json");

function log(msg: string) {
  console.log(`[dummy-cycle] ${msg}`);
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arena Dummy Agent</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
      color: #e2e8f0;
    }
    .card {
      text-align: center;
      padding: 3rem 4rem;
      border-radius: 1.5rem;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(20px);
      box-shadow: 0 25px 50px rgba(0,0,0,0.3);
    }
    .icon { font-size: 4rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    .sub { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.8rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(16,185,129,0.15);
      color: #34d399;
      border: 1px solid rgba(16,185,129,0.3);
    }
    .dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #34d399;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .meta {
      margin-top: 1.5rem;
      font-size: 0.7rem;
      color: #64748b;
      font-family: ui-monospace, monospace;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#x1f916;</div>
    <h1>Dummy Agent</h1>
    <p class="sub">Pipeline smoke test completed successfully</p>
    <span class="badge"><span class="dot"></span> healthy</span>
    <p class="meta">project ${PROJECT_ID.slice(-12)} &middot; ${new Date().toISOString().slice(0, 19)}Z</p>
  </div>
</body>
</html>`;

const SERVER_JS = `
const http = require("http");
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf-8");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}).listen(PORT, () => console.log("Dummy app on :" + PORT));
`;

log("Starting dummy cycle");

// Write app files
mkdirSync(join(WORK_DIR, ".arena"), { recursive: true });
writeFileSync(join(WORK_DIR, "index.html"), HTML);
writeFileSync(join(WORK_DIR, "server.js"), SERVER_JS);
writeFileSync(join(WORK_DIR, "package.json"), JSON.stringify({
  name: "dummy-app",
  scripts: { start: "node server.js" },
}, null, 2));
// RA-247: arena-start.sh is the only way to start the app
writeFileSync(join(WORK_DIR, "arena-start.sh"), "#!/bin/bash\nexec node server.js\n");
try { execSync(`chmod +x ${join(WORK_DIR, "arena-start.sh")}`, { stdio: "pipe" }); } catch {}
writeFileSync(join(WORK_DIR, ".arena", "progress.json"), JSON.stringify({ state: "completed" }));
log("Wrote app files");

// Git commit + push
try {
  execSync("git add -A", { cwd: WORK_DIR, stdio: "pipe" });
  execSync('git commit -m "feat: dummy agent app"', { cwd: WORK_DIR, stdio: "pipe" });
  execSync(`git push origin ${PUSH_BRANCH}`, { cwd: WORK_DIR, stdio: "pipe", timeout: 30_000 });
  log("Committed and pushed");
} catch {
  log("Git commit/push failed (non-fatal)");
}

// Kill anything on :3000 and start app
try {
  execSync("fuser -k 3000/tcp 2>/dev/null || true", { cwd: WORK_DIR, stdio: "pipe" });
} catch { /* ignore */ }

execSync("setsid node server.js </dev/null >/tmp/app.log 2>&1 &", {
  cwd: WORK_DIR,
  stdio: "pipe",
  env: { ...scrubRunnerAuthEnv(process.env), PORT: "3000" },
  shell: "/bin/bash",
});

// Wait for health check
execSync("sleep 1", { stdio: "pipe" });
try {
  execSync("curl -sf http://localhost:3000/health", { stdio: "pipe", timeout: 5000 });
  log("App healthy on :3000");
} catch {
  log("Health check failed (non-fatal)");
}

// Signal completion via result.json
writeFileSync(RESULT_FILE, JSON.stringify({ status: "DEPLOYED", reason: "Dummy cycle completed" }));
log("Done");
