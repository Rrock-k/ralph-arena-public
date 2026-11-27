/**
 * HTTP client for governance callbacks.
 * Runner pushes logs, progress, terminal state; polls status and specs.
 */

import type {
  InitResponse,
  StatusResponse,
  SpecsResponse,
  AssetsResponse,
  AssetItem,
  LogChunk,
  TerminalRequest,
  RequestedSecretEntry,
  RequestSecretsResponse,
} from "@arena/contracts";

export type { InitResponse, StatusResponse, SpecsResponse, AssetsResponse, AssetItem, LogChunk, TerminalRequest, RequestedSecretEntry, RequestSecretsResponse };

export type InitData = InitResponse;
export type SpecsData = SpecsResponse;
export type AssetsData = AssetsResponse;
export type TerminalReport = TerminalRequest;
export type RequestSecretsData = RequestSecretsResponse;
export type StatusData = StatusResponse;

export interface VisualEvidenceIngestPayload {
  taskId: string;
  sourceEvidenceRef: string;
  progressJson: string;
  artifactFilename: string;
  artifactContentType: string;
  artifactContentBase64: string;
}

function governanceUrl(): string {
  return process.env.ARENA_GOVERNANCE_URL || "http://governance:3000";
}

function projectSecret(): string {
  return process.env.ARENA_PROJECT_SECRET || "";
}

function projectId(): string {
  return process.env.ARENA_PROJECT_ID || "";
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-arena-project-secret": projectSecret(),
  };
}

function url(path: string): string {
  return `${governanceUrl()}${path}`;
}

// ── Init ──────────────────────────────────────────────────

export async function fetchInit(): Promise<InitData> {
  const res = await fetch(url(`/api/internal/projects/${projectId()}/init`), {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Init failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<InitData>;
}

// ── Status polling ────────────────────────────────────────

const RUNNER_VERSION = process.env.ARENA_RUNNER_VERSION || "unknown";

export async function fetchStatus(options?: { state?: string | null; refreshAuth?: boolean }): Promise<StatusResponse> {
  const params = new URLSearchParams();
  if (options?.state) params.set("state", options.state);
  if (options?.refreshAuth) params.set("refreshAuth", "1");
  params.set("runnerVersion", RUNNER_VERSION);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const res = await fetch(url(`/api/internal/projects/${projectId()}/status${suffix}`), {
    headers: headers(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    if (options?.refreshAuth) {
      throw new Error(`Status refresh failed: ${res.status} ${await res.text()}`);
    }
    return { shouldStop: false };
  }
  return res.json();
}

export async function requestSecrets(entries: RequestedSecretEntry[]): Promise<RequestSecretsResponse> {
  const res = await fetch(url(`/api/internal/projects/${projectId()}/request-secrets`), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(entries),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Request secrets failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// ── Specs polling ─────────────────────────────────────────

export async function fetchSpecs(): Promise<SpecsResponse> {
  const res = await fetch(url(`/api/internal/projects/${projectId()}/specs`), {
    headers: headers(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Specs fetch failed: ${res.status}`);
  return res.json();
}

// ── Assets polling/download (RA-222) ───────────────────────

export async function fetchAssets(): Promise<AssetsResponse> {
  const res = await fetch(url(`/api/internal/projects/${projectId()}/assets`), {
    headers: headers(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Assets fetch failed: ${res.status}`);
  return res.json();
}

export async function downloadAsset(assetId: string): Promise<Buffer> {
  const res = await fetch(url(`/api/internal/projects/${projectId()}/assets/${assetId}/download`), {
    headers: headers(),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Asset download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Log push ──────────────────────────────────────────────

export async function pushLogs(chunks: LogChunk[]): Promise<void> {
  if (!chunks.length) return;
  try {
    await fetch(url(`/api/internal/projects/${projectId()}/logs`), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ chunks }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("[runner] pushLogs failed:", e);
  }
}

// ── Lifecycle events ──────────────────────────────────────

export async function pushLifecycleEvent(event: string): Promise<void> {
  try {
    await fetch(url(`/api/internal/projects/${projectId()}/logs`), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ lifecycle: [{ ts: Date.now(), event }] }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error(`[runner] pushLifecycleEvent(${event}) failed:`, e);
  }
}

// ── Progress push ─────────────────────────────────────────

export async function pushProgress(progress: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url(`/api/internal/project-progress`), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        projectId: projectId(),
        status: "RUNNING",
        ...progress,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`[runner] pushProgress failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[runner] pushProgress failed:", e);
    return false;
  }
}

export async function pushVisualEvidenceIngest(payload: VisualEvidenceIngestPayload): Promise<boolean> {
  try {
    const res = await fetch(url(`/api/internal/projects/${projectId()}/visual-evidence-ingest`), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error(`[runner] pushVisualEvidenceIngest failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[runner] pushVisualEvidenceIngest failed:", e);
    return false;
  }
}

// ── Events push/poll (RA-089) ────────────────────────────

export async function pushEvents(events: Array<{ type: string; payload: unknown }>): Promise<void> {
  if (!events.length) return;
  try {
    await fetch(url(`/api/internal/projects/${projectId()}/events`), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("[runner] pushEvents failed:", e);
  }
}

export async function fetchEvents(since?: string, type?: string): Promise<{ events: Array<Record<string, unknown>> }> {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  if (type) params.set("type", type);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const res = await fetch(url(`/api/internal/projects/${projectId()}/events${suffix}`), {
    headers: headers(),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return { events: [] };
  return res.json();
}

// ── Terminal report ───────────────────────────────────────

type TerminalReportResult = "accepted" | "already_terminated" | "failed";

function terminalRetryDelay(attempt: number, opts?: { initialDelayMs?: number; maxDelayMs?: number }): number {
  const initialDelayMs = opts?.initialDelayMs ?? 2_000;
  const maxDelayMs = opts?.maxDelayMs ?? 30_000;
  return Math.min(maxDelayMs, initialDelayMs * Math.max(1, attempt + 1));
}

function terminalContextSuffix(context?: string): string {
  return context ? ` (${context})` : "";
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postTerminalReport(
  report: Record<string, unknown> & { terminalState: string },
  attempt: number,
  context?: string,
): Promise<TerminalReportResult> {
  try {
    const res = await fetch(url(`/api/internal/projects/${projectId()}/terminal`), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return "accepted";
    if (res.status === 409) {
      console.log(`[runner] Project already terminated by governance (409) — skipping report`);
      return "already_terminated";
    }
    console.error(`[runner] Terminal report${terminalContextSuffix(context)} attempt ${attempt + 1} failed: ${res.status}`);
  } catch (err) {
    console.error(`[runner] Terminal report${terminalContextSuffix(context)} attempt ${attempt + 1} error:`, err);
  }
  return "failed";
}

/** Accepts loose shape — governance validates with Zod */
export async function reportTerminal(report: Record<string, unknown> & { terminalState: string }): Promise<void> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await postTerminalReport(report, attempt);
    if (result !== "failed") return;
    if (attempt < maxRetries - 1) {
      await sleep(2000 * (attempt + 1));
    }
  }
  console.error("[runner] Terminal report failed after all retries");
}

export async function reportTerminalUntilAccepted(
  report: Record<string, unknown> & { terminalState: string },
  opts?: {
    context?: string;
    initialDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const result = await postTerminalReport(report, attempt, opts?.context);
    if (result !== "failed") return;

    const delay = terminalRetryDelay(attempt, opts);
    console.error(
      `[runner] Terminal report${terminalContextSuffix(opts?.context)} not accepted; retrying in ${delay}ms`,
    );
    await sleep(delay);
  }
}
