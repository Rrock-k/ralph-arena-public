import http, { type IncomingMessage, type ServerResponse } from "http";
import { AuthService, ProviderNotFoundError } from "./service.js";

interface CreateAuthdServerOptions {
  service: AuthService;
  secret?: string;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function isAuthorized(request: IncomingMessage, secret: string): boolean {
  if (!secret) return true;
  return request.headers["x-authd-secret"] === secret;
}

export function createAuthdServer(options: CreateAuthdServerOptions): http.Server {
  const { service, secret = "" } = options;

  return http.createServer(async (request, response) => {
    const method = request.method || "GET";
    const pathname = new URL(request.url || "/", "http://authd.local").pathname;

    if (!isAuthorized(request, secret)) {
      json(response, 401, { error: "Unauthorized" });
      return;
    }

    try {
      if (method === "GET" && pathname === "/health") {
        json(response, 200, await service.health());
        return;
      }

      if (method === "GET" && pathname === "/providers") {
        json(response, 200, await service.health());
        return;
      }

      const providerHealthMatch = pathname.match(/^\/providers\/([^/]+)\/health$/);
      if (method === "GET" && providerHealthMatch) {
        json(response, 200, await service.getProviderHealth(providerHealthMatch[1]));
        return;
      }

      const providerRefreshMatch = pathname.match(/^\/providers\/([^/]+)\/refresh$/);
      if (method === "POST" && providerRefreshMatch) {
        json(response, 200, await service.refreshProvider(providerRefreshMatch[1]));
        return;
      }

      const providerQuotaMatch = pathname.match(/^\/providers\/([^/]+)\/quota$/);
      if (method === "GET" && providerQuotaMatch) {
        json(response, 200, await service.getProviderQuota(providerQuotaMatch[1]));
        return;
      }

      if (method === "GET" && pathname === "/quota-windows") {
        json(response, 200, await service.quotaSnapshot());
        return;
      }

      const providerPostMortemMatch = pathname.match(/^\/providers\/([^/]+)\/post-mortem$/);
      if (method === "POST" && providerPostMortemMatch) {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          json(response, 400, { error: "Expected JSON object body." });
          return;
        }
        json(response, 200, await service.providerPostMortem(providerPostMortemMatch[1], body));
        return;
      }

      if (method === "POST" && pathname === "/mint-run-auth") {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          json(response, 400, { error: "Expected JSON object body." });
          return;
        }
        json(response, 200, await service.mintRunAuth(body as Record<string, unknown>));
        return;
      }

      json(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof ProviderNotFoundError) {
        json(response, 404, { error: error.message });
        return;
      }

      if (error instanceof SyntaxError) {
        json(response, 400, { error: "Invalid JSON body." });
        return;
      }

      json(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
