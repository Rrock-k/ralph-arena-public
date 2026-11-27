/**
 * Core proxy logic: forward API requests to providers,
 * pipe streaming responses, and extract token usage.
 */

import { type IncomingMessage, type ServerResponse } from "node:http";
import { getProjectInfo } from "./run-registry.js";
import { checkBudget, invalidateBudgetCache } from "./budget-check.js";
import { getPrisma } from "./db.js";
import { calculateCostUsd } from "./pricing.js";
import {
  parseAnthropicResponse,
  parseAnthropicStreamEvents,
  parseOpenaiResponse,
  parseOpenaiStreamEvents,
  type TokenUsage,
} from "./usage-parser.js";

// Match: /{provider}/project/{projectId}/{rest...}
// Also support legacy /{provider}/run/{projectId}/{rest...} for in-flight containers
const PATH_RE = /^\/(anthropic|openai)\/(?:project|run)\/([^/]+)(\/.*)?$/;

function buildTargetUrl(provider: string, targetBase: string, realPath: string): string {
  const base = targetBase.replace(/\/$/, "");
  if (provider !== "openai") {
    return `${base}${realPath}`;
  }

  // OpenAI SDKs vary: some send /responses, some /v1/responses.
  // Normalize to exactly one /v1 segment in the final upstream URL.
  let openaiBase = base;
  let path = realPath || "/";
  const baseHasV1 = /\/v1$/.test(openaiBase);
  const pathHasV1 = path === "/v1" || path.startsWith("/v1/");

  if (!baseHasV1 && !pathHasV1) {
    openaiBase = `${openaiBase}/v1`;
  }
  if (baseHasV1 && pathHasV1) {
    path = path === "/v1" ? "/" : path.slice(3);
  }

  return `${openaiBase}${path}`;
}

function platformProviderKey(provider: string): string | null {
  const key = provider === "anthropic"
    ? process.env.ANTHROPIC_API_KEY
    : process.env.OPENAI_API_KEY;
  return key?.trim() || null;
}

export function applyPlatformCreditsAuth(provider: string, headers: Record<string, string>): boolean {
  const key = platformProviderKey(provider);
  if (!key) return false;

  if (provider === "anthropic") {
    delete headers.authorization;
    delete headers.Authorization;
    headers["x-api-key"] = key;
  } else {
    headers.authorization = `Bearer ${key}`;
    delete headers.Authorization;
  }

  return true;
}

export async function handleProxyRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const match = url.match(PATH_RE);

  if (!match) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Expected /{provider}/project/{projectId}/..." }));
    return;
  }

  const [, provider, projectId, realPath = "/"] = match;
  const prisma = getPrisma();
  const projectInfo = getProjectInfo(projectId);

  if (!projectInfo) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Project ${projectId} not registered` }));
    return;
  }

  // Budget check
  const budget = await checkBudget(prisma, projectInfo.projectId, projectInfo.providerBillingMode);
  if (!budget.allowed) {
    console.log(`[api-proxy] BLOCKED project=${projectId} remaining=$${budget.remaining.toFixed(4)}`);
    res.writeHead(402, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: {
        type: "budget_exhausted",
        message: `Project budget exhausted (remaining: $${budget.remaining.toFixed(2)}). Contact admin to add credits.`,
      },
    }));
    return;
  }

  // Determine target URL
  const targetBase = provider === "anthropic"
    ? projectInfo.targetAnthropicUrl
    : projectInfo.targetOpenaiUrl;
  const targetUrl = buildTargetUrl(provider!, targetBase, realPath);

  // Read request body
  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(chunk as Buffer);
  }
  const requestBody = Buffer.concat(bodyChunks);

  // Forward headers (remove host, add original headers)
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!key || !value) continue;
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "transfer-encoding") continue;
    forwardHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  if (projectInfo.providerBillingMode === "platform_credits") {
    if (!applyPlatformCreditsAuth(provider!, forwardHeaders)) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          type: "provider_auth_unavailable",
          message: `Platform ${provider} API key is not configured in api-proxy.`,
        },
      }));
      return;
    }
  }

  // Detect if streaming is requested
  const isStreaming = requestBody.toString().includes('"stream":true') ||
    requestBody.toString().includes('"stream": true');

  try {
    const method = (req.method ?? "POST").toUpperCase();
    const canHaveBody = method !== "GET" && method !== "HEAD";
    const response = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: canHaveBody ? requestBody : undefined,
    });

    // Forward response status and headers
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      // Skip hop-by-hop headers
      if (key === "transfer-encoding" || key === "connection") return;
      responseHeaders[key] = value;
    });
    res.writeHead(response.status, responseHeaders);

    if (!response.body) {
      res.end();
      return;
    }

    if (isStreaming && response.ok) {
      // Streaming: pipe chunks to client while buffering for usage extraction
      await handleStreamingResponse(res, response, provider!, projectId);
    } else {
      // Non-streaming: read full body, parse usage, then send to client
      await handleNonStreamingResponse(res, response, provider!, projectId);
    }
  } catch (error) {
    console.error(`[api-proxy] Proxy error for project=${projectId}:`, error);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy error" }));
    } else if (!res.writableEnded) {
      res.end();
    }
  }
}

async function handleStreamingResponse(
  res: ServerResponse,
  response: Response,
  provider: string,
  projectId: string,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let streamBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Forward chunk to client immediately
      const chunk = value;
      res.write(chunk);

      // Buffer for usage parsing
      streamBuffer += decoder.decode(chunk, { stream: true });
    }

    // Flush decoder
    streamBuffer += decoder.decode();
    res.end();

    // Parse usage from buffered stream
    const usage = provider === "anthropic"
      ? parseAnthropicStreamEvents(streamBuffer)
      : parseOpenaiStreamEvents(streamBuffer);

    if (usage) {
      await recordUsage(projectId, provider, usage);
    }
  } catch (error) {
    console.error(`[api-proxy] Stream error for project=${projectId}:`, error);
    res.end();
  }
}

async function handleNonStreamingResponse(
  res: ServerResponse,
  response: Response,
  provider: string,
  projectId: string,
): Promise<void> {
  const bodyText = await response.text();
  res.end(bodyText);

  // Parse usage from response body
  if (response.ok) {
    try {
      const body = JSON.parse(bodyText);
      const usage = provider === "anthropic"
        ? parseAnthropicResponse(body)
        : parseOpenaiResponse(body);

      if (usage) {
        await recordUsage(projectId, provider, usage);
      }
    } catch {
      // Non-JSON response — skip usage parsing
    }
  }
}

async function recordUsage(
  projectId: string,
  provider: string,
  usage: TokenUsage,
): Promise<void> {
  const costUsd = calculateCostUsd(usage.inputTokens, usage.outputTokens, usage.model);

  console.log(
    `[api-proxy] project=${projectId} provider=${provider} model=${usage.model ?? "?"} ` +
    `in=${usage.inputTokens} out=${usage.outputTokens} cost=$${costUsd.toFixed(6)}`
  );

  try {
    const prisma = getPrisma();
    await prisma.$transaction(async (tx: any) => {
      await tx.apiUsage.create({
        data: {
          projectId,
          provider,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd,
        },
      });

      if (costUsd > 0) {
        await tx.projectBudget.updateMany({
          where: { projectId, isEnabled: true },
          data: { usedCreditsUsd: { increment: costUsd } },
        });
        await tx.project.update({
          where: { id: projectId },
          data: { budgetDebitedUsd: { increment: costUsd } },
        });
      }
    });

    invalidateBudgetCache(projectId);
  } catch (error) {
    console.error(`[api-proxy] Failed to record usage for project=${projectId}:`, error);
  }
}
