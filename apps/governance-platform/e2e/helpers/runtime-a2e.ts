import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

export type ProjectState = {
  id: string;
  mode: string;
  projectState: string;
  displayStatus: string;
  name: string;
  previewUrl: string | null;
  containerName?: string | null;
  workerHost?: string | null;
  vpsHost?: {
    ip: string | null;
  } | null;
  galleryFeatured?: boolean;
  primaryComponent?: {
    desiredRuntime: string;
    actualRuntime: string;
    implState: string | null;
    pauseReason: string | null;
  } | null;
  specs: Array<{
    id: string;
    title: string | null;
    content: string;
    orderIndex: number;
  }>;
  components: Array<{
    id: string;
    name: string;
    kind: string;
    desiredRuntime: string;
    actualRuntime: string;
    implState: string | null;
    pauseReason: string | null;
    sourceType: string;
  }>;
  runLogs?: Array<{
    id: string;
    event: string;
    detail: string | null;
    createdAt: string;
  }>;
};

export type WorkerParity = {
  environment: "local" | "vps";
  expectedCommitSha: string | null;
  expectedWorkerImage: string | null;
  actualWorkerGitSha: string | null;
  actualRunnerGitSha: string | null;
  actualWorkerImage: string | null;
  status: "clean" | "mismatch" | "n/a";
  reasons: string[];
};

export type WorkerSnapshot = {
  projectId: string;
  workerUrl: string | null;
  meta: Record<string, unknown> | null;
  inspect: Record<string, unknown> | null;
  logs: { logs?: string } | null;
  parity?: WorkerParity | null;
  errors?: Record<string, unknown>;
};

const TRANSIENT_REQUEST_ERROR_PATTERNS = [
  "socket hang up",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
];

const TRANSIENT_NAVIGATION_ERROR_PATTERNS = [
  "ERR_EMPTY_RESPONSE",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_RESET",
  "ERR_HTTP2_PROTOCOL_ERROR",
  "ERR_TIMED_OUT",
  "net::ERR_ABORTED",
];

const RETRYABLE_RESPONSE_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1_500, 1_500, 2_000, 3_000, 5_000, 5_000];

function isTransientRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_REQUEST_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function isTransientNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_NAVIGATION_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

async function sleepForRetry(attempt: number): Promise<void> {
  const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function requestJsonWithRetry<T>(
  requestFn: () => Promise<APIResponse>,
  options?: { requireOk?: boolean },
): Promise<T> {
  const requireOk = options?.requireOk ?? true;
  let lastError: unknown;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await requestFn();
      const body = await response.json().catch(() => null);

      if (response.ok()) {
        return body as T;
      }

      const errorPayload = body ?? {
        status: response.status(),
        statusText: response.statusText(),
      };

      if (!requireOk) {
        if (!RETRYABLE_RESPONSE_STATUSES.has(response.status()) || attempt === RETRY_DELAYS_MS.length - 1) {
          return errorPayload as T;
        }
        lastError = new Error(JSON.stringify(errorPayload));
        await sleepForRetry(attempt);
        continue;
      }

      if (!RETRYABLE_RESPONSE_STATUSES.has(response.status()) || attempt === RETRY_DELAYS_MS.length - 1) {
        throw new Error(JSON.stringify(errorPayload));
      }

      lastError = new Error(JSON.stringify(errorPayload));
    } catch (error) {
      lastError = error;
      if (!isTransientRequestError(error) || attempt === RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
    }

    await sleepForRetry(attempt);
  }

  throw lastError;
}

export async function postJsonWithRetry<T>(
  request: APIRequestContext,
  url: string,
  options?: {
    data?: Record<string, unknown>;
    headers?: Record<string, string>;
    requireOk?: boolean;
  },
): Promise<T> {
  return requestJsonWithRetry<T>(() => request.post(url, {
    data: options?.data,
    headers: options?.headers,
  }), { requireOk: options?.requireOk });
}

export async function getJsonWithRetry<T>(
  request: APIRequestContext,
  url: string,
  options?: {
    headers?: Record<string, string>;
    params?: Record<string, string>;
    requireOk?: boolean;
  },
): Promise<T> {
  return requestJsonWithRetry<T>(() => request.get(url, {
    headers: options?.headers,
    params: options?.params,
  }), { requireOk: options?.requireOk });
}

export async function a2ePost<T>(
  request: APIRequestContext,
  data: Record<string, unknown>,
): Promise<T> {
  return postJsonWithRetry<T>(request, "/api/test/a2e", {
    data,
    headers: { cookie: "e2e_admin_bypass=1" },
  });
}

export async function getProjectState(request: APIRequestContext, projectId: string): Promise<ProjectState> {
  return getJsonWithRetry<ProjectState>(request, "/api/test/a2e", {
    params: { projectId },
  });
}

export async function getWorkerSnapshot(
  request: APIRequestContext,
  projectId: string,
): Promise<WorkerSnapshot> {
  return a2ePost<WorkerSnapshot>(request, {
    action: "worker_snapshot",
    projectId,
  });
}

export async function waitForProject(
  request: APIRequestContext,
  projectId: string,
  predicate: (state: ProjectState) => boolean,
  timeoutMs = 240_000,
): Promise<ProjectState> {
  const startedAt = Date.now();
  let lastState: ProjectState | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await getProjectState(request, projectId);
    if (predicate(lastState)) {
      return lastState;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(`Timed out waiting for project ${projectId}. Last state: ${JSON.stringify(lastState)}`);
}

export async function gotoWithRetry(page: Page, url: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientNavigationError(error) || attempt === RETRY_DELAYS_MS.length - 1) {
        throw error;
      }
      await page.waitForTimeout(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
    }
  }

  throw lastError;
}

export async function openPreview(page: Page, previewUrl: string) {
  await gotoWithRetry(page, previewUrl);
}

type PreviewProbe = {
  url: string;
  headers?: Record<string, string>;
};

function buildPreviewProbe(previewUrl: string): PreviewProbe {
  const parsed = new URL(previewUrl);
  if (!parsed.hostname.endsWith(".localhost")) {
    return { url: previewUrl };
  }

  const hostHeader = parsed.host;
  parsed.hostname = "127.0.0.1";
  return {
    url: parsed.toString(),
    headers: { host: hostHeader },
  };
}

export async function getPreviewResponse(
  request: APIRequestContext,
  previewUrl: string,
  opts?: {
    failOnStatusCode?: boolean;
    timeout?: number;
    headers?: Record<string, string>;
  },
) {
  const probe = buildPreviewProbe(previewUrl);
  return request.get(probe.url, {
    ...opts,
    headers: {
      ...(probe.headers ?? {}),
      ...(opts?.headers ?? {}),
    },
  });
}

export async function expectPreviewStatus(
  request: APIRequestContext,
  previewUrl: string,
  expectedStatus: number,
  timeoutMs = 120_000,
) {
  await expect
    .poll(
      async () => {
        try {
          const response = await getPreviewResponse(request, previewUrl, {
            failOnStatusCode: false,
            timeout: 15_000,
          });
          return response.status();
        } catch {
          return 0;
        }
      },
      { timeout: timeoutMs },
    )
    .toBe(expectedStatus);
}

export async function expectPreviewNotHealthy(
  request: APIRequestContext,
  previewUrl: string,
  timeoutMs = 60_000,
) {
  await expect
    .poll(
      async () => {
        try {
          const response = await getPreviewResponse(request, previewUrl, {
            failOnStatusCode: false,
            timeout: 10_000,
          });
          return response.status();
        } catch {
          return 0;
        }
      },
      { timeout: timeoutMs },
    )
    .not.toBe(200);
}

export async function expectWorkerParityClean(
  request: APIRequestContext,
  projectId: string,
  timeoutMs = 120_000,
) {
  await expect
    .poll(
      async () => {
        const snapshot = await getWorkerSnapshot(request, projectId);
        return snapshot.parity ?? null;
      },
      { timeout: timeoutMs },
    )
    .toMatchObject({ status: "clean" });
}
