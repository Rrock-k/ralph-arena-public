const DEFAULT_WORKER_URL = process.env.WORKER_AGENT_URL ?? "http://localhost:4201";

/**
 * Resolve the worker-agent base URL for a given project.
 * Local projects → WORKER_AGENT_URL (localhost).
 * VPS projects → http://{vpsIp}:4200.
 * Returns null if workerHost is set but no VPS IP found (unknown host).
 */
export function resolveWorkerUrl(
  workerHost: string | null | undefined,
  vpsIp?: string | null,
): string | null {
  if (!workerHost || workerHost === "local") {
    return DEFAULT_WORKER_URL;
  }
  if (vpsIp) return `http://${vpsIp}:4200`;
  return null;
}
