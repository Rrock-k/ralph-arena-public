/**
 * RA-042: API Proxy for centralized token counting and budget enforcement.
 *
 * Sits between agent containers and LLM provider APIs.
 * All API calls from agents are routed through this proxy via
 * ANTHROPIC_BASE_URL / OPENAI_BASE_URL env vars.
 *
 * Features:
 * - Per-request token usage tracking (→ ApiUsage table)
 * - Pre-request budget check (→ 402 if exhausted)
 * - Streaming SSE passthrough with usage extraction
 * - Project registration/unregistration by the dispatcher
 */

import "dotenv/config";
import { createServer } from "node:http";
import { registerProject, unregisterProject, getProjectInfo, getActiveProjectCount } from "./run-registry.js";
import { handleProxyRequest } from "./proxy.js";
import { initPrismaClient } from "./db.js";
import { invalidateBudgetCache } from "./budget-check.js";

const PORT = Number(process.env.API_PROXY_PORT ?? 4100);
const API_PROXY_SECRET = (process.env.API_PROXY_SECRET ?? "").trim();

function checkManagementAuth(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): boolean {
  if (!API_PROXY_SECRET) return true; // No secret configured = no auth (dev mode)
  const provided = req.headers["x-proxy-secret"] as string | undefined;
  if (provided !== API_PROXY_SECRET) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }
  return true;
}

async function main() {
  // Initialize Prisma client
  await initPrismaClient();

  if (API_PROXY_SECRET) {
    console.log("[api-proxy] Management auth: enabled");
  } else {
    console.log("[api-proxy] Management auth: disabled (set API_PROXY_SECRET to enable)");
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // Health check (no auth required)
    if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, activeProjects: getActiveProjectCount() }));
      return;
    }

    // Project registration (called by dispatcher/worker-agent)
    const registerMatch = url.match(/^\/projects\/([^/]+)\/register$/);
    if (registerMatch && method === "POST") {
      if (!checkManagementAuth(req, res)) return;
      const projectId = registerMatch[1];
      const body = await readJsonBody(req);
      registerProject(projectId, {
        projectId,
        targetAnthropicUrl: body?.targetAnthropicUrl ?? "https://api.anthropic.com",
        targetOpenaiUrl: body?.targetOpenaiUrl ?? "https://api.openai.com",
        providerBillingMode: body?.providerBillingMode ?? null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Project unregistration
    const unregisterMatch = url.match(/^\/projects\/([^/]+)\/unregister$/);
    if (unregisterMatch && method === "POST") {
      if (!checkManagementAuth(req, res)) return;
      const projectInfo = getProjectInfo(unregisterMatch[1]);
      unregisterProject(unregisterMatch[1]);
      if (projectInfo) {
        invalidateBudgetCache(projectInfo.projectId);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // API proxy: /{provider}/project/{projectId}/... (also legacy /run/ path)
    if (url.match(/^\/(anthropic|openai)\/(?:project|run)\//)) {
      await handleProxyRequest(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`[api-proxy] Listening on :${PORT}`);
    console.log(`[api-proxy] Health: http://localhost:${PORT}/health`);
    console.log(`[api-proxy] Proxy: http://localhost:${PORT}/{anthropic|openai}/project/{projectId}/...`);
  });
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error("[api-proxy] Fatal:", error);
  process.exit(1);
});
