import type { RequiredSecretEntry } from "@/lib/required-secrets";

export type ProjectRecipeId = "simple_web" | "openclaw";

export type ProjectRecipeDefinition = {
  id: ProjectRecipeId;
  title: string;
  summary: string;
  agent: string;
  agentImpl: string;
  envOverrides?: Record<string, string | null>;
  requiredSecrets: RequiredSecretEntry[];
  component: {
    name: string;
    kind: string;
    sourceType: string;
    sourceConfig: Record<string, unknown>;
    runtimeConfig: Record<string, unknown>;
  };
};

const DEFAULT_OPENCLAW_WORKER_IMAGE = process.env.OPENCLAW_WORKER_IMAGE || "arena-public-worker-openclaw:local";

const SIMPLE_WEB_COMMAND = `set -eu
mkdir -p .arena-simple-web
cat > .arena-simple-web/server.mjs <<'EOF'
import http from 'node:http';

const port = Number(process.env.PORT || process.env.APP_PORT || 3000);
const projectId = process.env.ARENA_PROJECT_ID || 'unknown-project';
const startedAt = new Date().toISOString();

function renderPage() {
  return '<!doctype html>' +
    '<html lang="en"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>Simple Web Template</title>' +
    '<style>' +
    'body{margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#f8fafc;color:#0f172a;}' +
    'main{max-width:760px;margin:0 auto;padding:48px 24px;line-height:1.6;}' +
    'h1{font-size:2rem;margin:0 0 0.5rem;}' +
    'p{margin:0.75rem 0;}' +
    'code{background:#e2e8f0;border-radius:6px;padding:0.2rem 0.4rem;}' +
    '.card{background:#fff;border:1px solid #cbd5e1;border-radius:18px;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,0.08);}' +
    '</style></head><body><main><div class="card">' +
    '<h1>Simple Web Template</h1>' +
    '<p>This project is running through the Ralph Arena recipe runtime path.</p>' +
    '<p>Project id: <code>' + projectId + '</code></p>' +
    '<p>Started at: <code>' + startedAt + '</code></p>' +
    '<p>Health check: <code>/health</code></p>' +
    '</div></main></body></html>';
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, projectId, startedAt }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(renderPage());
});

server.listen(port, '0.0.0.0', () => {
  console.log('[simple-web] listening on http://0.0.0.0:' + port);
});
EOF
node .arena-simple-web/server.mjs`;

const OPENCLAW_GATEWAY_COMMAND = `set -eu
export OPENCLAW_STATE_DIR="\${OPENCLAW_STATE_DIR:-$(pwd)/.arena-openclaw/state}"
export OPENCLAW_CONFIG_PATH="\${OPENCLAW_CONFIG_PATH:-$OPENCLAW_STATE_DIR/openclaw.json}"
mkdir -p .arena-openclaw
cat > .arena-openclaw/bootstrap.mjs <<'EOF'
import path from 'node:path';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';

const stateDir = process.env.OPENCLAW_STATE_DIR || path.resolve('.arena-openclaw/state');
const configPath = process.env.OPENCLAW_CONFIG_PATH || path.join(stateDir, 'openclaw.json');
const previewOrigin = (process.env.ARENA_PREVIEW_ORIGIN || '').trim();
const allowedOrigins = previewOrigin
  ? [previewOrigin]
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];
const workspacePath = path.join(stateDir, 'workspace');
const password = process.env.OPENCLAW_GATEWAY_PASSWORD || '';

if (!password) {
  throw new Error('OPENCLAW_GATEWAY_PASSWORD is required');
}

const config = {
  gateway: {
    mode: 'local',
    bind: 'lan',
    auth: {
      mode: 'password',
    },
    controlUi: {
      allowedOrigins,
      allowInsecureAuth: true,
      // Preview traffic comes through Arena's reverse proxy; disable device pairing
      // here and rely on project ownership + gateway password for MVP access control.
      dangerouslyDisableDeviceAuth: true,
    },
  },
  browser: {
    enabled: false,
  },
  canvasHost: {
    enabled: false,
  },
  discovery: {
    mdns: {
      mode: 'off',
    },
  },
  agents: {
    defaults: {
      workspace: workspacePath,
      model: {
        primary: 'openai/gpt-5.4',
      },
    },
  },
  ...(process.env.TELEGRAM_BOT_TOKEN
    ? {
        channels: {
          telegram: {
            enabled: true,
          },
        },
      }
    : {}),
};

mkdirSync(stateDir, { recursive: true });
mkdirSync(workspacePath, { recursive: true });
chmodSync(stateDir, 0o700);
writeFileSync(configPath, JSON.stringify(config, null, 2));
chmodSync(configPath, 0o600);
EOF
node .arena-openclaw/bootstrap.mjs
exec openclaw gateway --port 3000 --bind lan --verbose`;

export const PROJECT_RECIPES: Record<ProjectRecipeId, ProjectRecipeDefinition> = {
  simple_web: {
    id: "simple_web",
    title: "Simple Web Template",
    summary: "Minimal preview-ready web service that proves the recipe runtime path without extra secrets or external dependencies.",
    agent: "service",
    agentImpl: "simple_web",
    requiredSecrets: [],
    component: {
      name: "web",
      kind: "app",
      sourceType: "managed",
      sourceConfig: {
        recipeId: "simple_web",
        runtime: "inline_node_http",
      },
      runtimeConfig: {
        recipeId: "simple_web",
        bootstrap: "direct_command",
        commandTemplate: SIMPLE_WEB_COMMAND,
        progressSync: false,
        eventSync: false,
        logStreaming: false,
        servicePort: 3000,
        webInterface: true,
      },
    },
  },
  openclaw: {
    id: "openclaw",
    title: "OpenClaw Template",
    summary: "Personal AI assistant with built-in web control UI and optional Telegram channel.",
    agent: "openclaw",
    agentImpl: "gateway",
    envOverrides: {
      // OpenClaw gateway exits immediately when CI=true is present.
      CI: null,
      // Container runs are capped to 4GB in local worker-agent; cap Node heap to
      // avoid the gateway being OOM-killed during startup.
      NODE_OPTIONS: "--max-old-space-size=2048",
    },
    requiredSecrets: [
      {
        key: "OPENCLAW_GATEWAY_PASSWORD",
        description: "Password protecting the OpenClaw gateway web UI and websocket control plane.",
        blocking: true,
      },
      {
        key: "OPENAI_API_KEY",
        description: "Model provider key used by OpenClaw for assistant responses.",
        blocking: true,
      },
      {
        key: "TELEGRAM_BOT_TOKEN",
        description: "Optional Telegram bot token if you want to chat with OpenClaw via Telegram.",
        blocking: false,
      },
    ],
    component: {
      name: "gateway",
      kind: "app",
      sourceType: "package",
      sourceConfig: {
        recipeId: "openclaw",
        packageName: "openclaw",
        packageVersion: "latest",
        repositoryUrl: "https://github.com/openclaw/openclaw",
        docsUrl: "https://docs.openclaw.ai",
      },
      runtimeConfig: {
        recipeId: "openclaw",
        bootstrap: "direct_command",
        commandTemplate: OPENCLAW_GATEWAY_COMMAND,
        cycleImage: DEFAULT_OPENCLAW_WORKER_IMAGE,
        progressSync: false,
        eventSync: false,
        logStreaming: false,
        memoryMb: 8192,
        cpuCount: 4,
        servicePort: 3000,
        webInterface: true,
      },
    },
  },
};

export function getProjectRecipe(recipeId: ProjectRecipeId): ProjectRecipeDefinition {
  return PROJECT_RECIPES[recipeId];
}

export function listProjectRecipes(): ProjectRecipeDefinition[] {
  return Object.values(PROJECT_RECIPES);
}
