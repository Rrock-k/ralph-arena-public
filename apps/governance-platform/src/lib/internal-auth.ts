/**
 * Shared auth helpers for internal API endpoints.
 *
 * Two auth schemes:
 * - Runner auth: x-arena-project-secret header (per-project token, used by runner inside container)
 * - Worker auth: x-worker-secret header (shared secret, used by worker-agent on host)
 */

import { extractBypassHost, isLocalBypassHost } from "@/lib/e2e-auth-bypass";
import { createHmac, timingSafeEqual } from "node:crypto";

const isProd = process.env.NODE_ENV === "production";
const RUNNER_PROJECT_SECRET_PREFIX = "rp1";

function allowMissingSecretInLocalDev(request: Request, secretName: string): boolean {
  if (isProd) return false;
  const host = extractBypassHost(request.headers.get("host"));
  if (!isLocalBypassHost(host)) return false;
  console.warn(`[auth] ${secretName} not set — allowing request from local dev host ${host}`);
  return true;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readRunnerSecretHeader(request: Request): string | null {
  return request.headers.get("x-arena-project-secret")
    || request.headers.get("x-arena-run-secret")
    || request.headers.get("x-runner-secret");
}

export function createRunnerProjectSecret(
  projectId: string,
  secret = process.env.RUNNER_WEBHOOK_SECRET,
): string {
  const trimmedSecret = secret?.trim();
  const trimmedProjectId = projectId.trim();
  if (!trimmedSecret || !trimmedProjectId) return "";

  const signature = createHmac("sha256", trimmedSecret)
    .update(`${RUNNER_PROJECT_SECRET_PREFIX}:${trimmedProjectId}`)
    .digest("base64url");
  return `${RUNNER_PROJECT_SECRET_PREFIX}.${trimmedProjectId}.${signature}`;
}

function isRunnerProjectTokenAuthorized(
  header: string | null,
  secret: string,
  projectId: string,
): boolean {
  if (!header) return false;
  const expected = createRunnerProjectSecret(projectId, secret);
  return expected !== "" && timingSafeStringEqual(header, expected);
}

export function isRunnerAuthorized(
  request: Request,
  options: { projectId?: string | null } = {},
): boolean {
  const secret = process.env.RUNNER_WEBHOOK_SECRET;
  if (!secret) {
    return allowMissingSecretInLocalDev(request, "RUNNER_WEBHOOK_SECRET");
  }
  const header = readRunnerSecretHeader(request);
  const projectId = options.projectId?.trim();

  if (projectId) {
    return isRunnerProjectTokenAuthorized(header, secret, projectId);
  }

  return !!header && timingSafeStringEqual(header, secret);
}

export function isWorkerAuthorized(request: Request): boolean {
  const secret = process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET;
  if (!secret) {
    return allowMissingSecretInLocalDev(request, "WORKER_SECRET");
  }
  return request.headers.get("x-worker-secret") === secret;
}

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return allowMissingSecretInLocalDev(request, "CRON_SECRET");
  }
  return request.headers.get("x-cron-secret") === secret;
}

export function isEvolutionPushAuthorized(request: Request): boolean {
  return isTgSpecInternalAuthorized(request);
}

export function isTgSpecInternalAuthorized(request: Request): boolean {
  const secret = process.env.ARENA_PUSH_SECRET;
  if (!secret) {
    return allowMissingSecretInLocalDev(request, "ARENA_PUSH_SECRET");
  }
  return request.headers.get("x-evolution-push-secret") === secret;
}
