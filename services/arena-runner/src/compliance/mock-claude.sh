#!/bin/bash
# Mock claude CLI for compliance testing (RA-196)
#
# Context-aware: detects whether the call is from planner, controller, or executor
# by reading the prompt from stdin, and responds with appropriate stream-json output.
#
# Handles: claude --version, claude --print ... -

set -e

# Handle --version flag (ralph calls this to check availability)
for arg in "$@"; do
  if [ "$arg" = "--version" ]; then
    echo "mock-claude 1.0.0 (compliance test)"
    exit 0
  fi
done

# Read prompt from stdin (ralph sends prompt via stdin with "-" arg)
PROMPT=""
if [ -t 0 ]; then
  : # No stdin, skip
else
  PROMPT="$(cat)"
fi

WORK_DIR="$(pwd)"

# Detect call type from prompt content
if echo "$PROMPT" | grep -q '"phases"'; then
  # ── Planner call: return a minimal valid plan ──────────────────
  PLAN_JSON='{
    "projectGoal": "Create a hello-world HTTP server",
    "phases": [{
      "id": "phase-1",
      "name": "Setup",
      "description": "Create the basic application",
      "order": 1,
      "tasks": [{
        "id": "task-1",
        "description": "Create HTTP server with health endpoint and bootstrap script",
        "acceptanceCriteria": ["server.js exists", "arena-start.sh exists and is executable", "GET /health returns 200"]
      }]
    }],
    "judgments": [{
      "id": "judgment-1",
      "timestamp": "2026-01-01T00:00:00Z",
      "ambiguity": "Which web framework to use",
      "options": ["Express", "Plain HTTP module"],
      "chosen": 1,
      "reasoning": "Plain HTTP keeps it simple with zero dependencies",
      "madeBy": "planner"
    }]
  }'

  # Output in stream-json NDJSON format
  echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":$(echo "$PLAN_JSON" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}]}}"
  echo "{\"type\":\"result\",\"result\":$(echo "$PLAN_JSON" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}"

elif echo "$PROMPT" | grep -q '"verdict"'; then
  # ── Controller call: return "continue" verdict ─────────────────
  REPORT_JSON='{
    "verdict": "continue",
    "summary": "Task completed successfully by mock agent"
  }'

  echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":$(echo "$REPORT_JSON" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}]}}"
  echo "{\"type\":\"result\",\"result\":$(echo "$REPORT_JSON" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}"

else
  # ── Executor call: create files + return result ────────────────

  # Create minimal app files
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
}).listen(PORT, () => console.log("Mock app on :" + PORT));
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

  # Output in stream-json format
  echo '{"type":"assistant","message":{"content":[{"type":"text","text":"I have created server.js, package.json, and arena-start.sh for the hello-world HTTP server."}]}}'
  echo '{"type":"result","result":"Mock agent completed all tasks successfully. Created server.js with /health endpoint and arena-start.sh for preview startup."}'
fi
