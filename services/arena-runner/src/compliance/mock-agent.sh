#!/bin/bash
# Mock agent for compliance testing
# Creates a minimal hello-world app without calling any LLM
# Usage: bash mock-agent.sh /path/to/workspace

set -e

WORK_DIR="${1:-.}"

# Create minimal HTTP server
cat > "$WORK_DIR/server.js" << 'SCRIPT'
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end('{"ok":true}');
  } else {
    res.writeHead(200, {"Content-Type":"text/html"});
    res.end("<h1>Hello from mock agent</h1>");
  }
}).listen(PORT, () => console.log(`Mock app on :${PORT}`));
SCRIPT

cat > "$WORK_DIR/package.json" << 'PKG'
{"name":"mock-app","scripts":{"start":"node server.js"}}
PKG

# arena-start.sh — RA-247 contract requirement
cat > "$WORK_DIR/arena-start.sh" << 'START'
#!/bin/bash
exec node server.js
START
chmod +x "$WORK_DIR/arena-start.sh"

# progress.json (optional but recommended)
cat > "$WORK_DIR/.arena/progress.json" << 'PROGRESS'
{"state":"completed","message":"Mock agent finished"}
PROGRESS

# Git commit
cd "$WORK_DIR"
git add -A
git commit -m "feat: mock agent app" --allow-empty 2>/dev/null || true

# result.json — terminal signal to runner (contract requirement)
cat > "$WORK_DIR/.arena/result.json" << 'RESULT'
{"status":"DEPLOYED","reason":"Mock agent completed"}
RESULT

echo "Mock agent done"
