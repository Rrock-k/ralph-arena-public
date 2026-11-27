type PreviewFetchResponse = {
  ok: boolean;
  status: number;
};

type PreviewFetch = (
  url: string,
  init: {
    method: "GET";
    signal: AbortSignal;
  },
) => Promise<PreviewFetchResponse>;

export type PreviewContainerInspect = {
  State?: {
    Running?: boolean;
    Status?: string;
    ExitCode?: number | null;
  };
};

export type PreviewServingDeps = {
  inspectContainer: (containerName: string) => Promise<PreviewContainerInspect | null>;
  fetchImpl?: PreviewFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  healthTimeoutMs?: number;
  healthPollMs?: number;
  requestTimeoutMs?: number;
  requiredSuccesses?: number;
};

export type ContainerRunningDeps = {
  inspectContainer: (containerName: string) => Promise<PreviewContainerInspect | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  runningTimeoutMs?: number;
  runningPollMs?: number;
  requiredRunningPolls?: number;
};

export type RunnerControlServingDeps = {
  inspectContainer: (containerName: string) => Promise<PreviewContainerInspect | null>;
  fetchImpl?: PreviewFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  controlTimeoutMs?: number;
  controlPollMs?: number;
  requestTimeoutMs?: number;
  requiredSuccesses?: number;
};

export async function waitForPreviewServing(
  containerName: string,
  deps: PreviewServingDeps,
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as PreviewFetch);
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const healthTimeoutMs = deps.healthTimeoutMs ?? 15_000;
  const healthPollMs = deps.healthPollMs ?? 1_000;
  const requiredSuccesses = deps.requiredSuccesses ?? 2;
  const deadline = now() + healthTimeoutMs;

  let consecutiveHealthyProbes = 0;
  let lastObservedError = "preview app did not become healthy";

  while (now() < deadline) {
    const inspect = await deps.inspectContainer(containerName);
    if (!inspect) {
      throw new Error(`Preview container ${containerName} disappeared before health check`);
    }

    if (!inspect.State?.Running) {
      const stateDescription = inspect.State?.Status || "stopped";
      const exitCode = typeof inspect.State?.ExitCode === "number" ? inspect.State.ExitCode : "unknown";
      lastObservedError = `container is ${stateDescription} (exit ${exitCode})`;
      consecutiveHealthyProbes = 0;
      await sleep(healthPollMs);
      continue;
    }

    const probe = await probePreviewServing(containerName, {
      fetchImpl,
      requestTimeoutMs: deps.requestTimeoutMs,
    });
    if (probe.ok) {
      consecutiveHealthyProbes += 1;
      if (consecutiveHealthyProbes >= requiredSuccesses) {
        return;
      }
    } else {
      consecutiveHealthyProbes = 0;
      lastObservedError = probe.error;
    }

    await sleep(healthPollMs);
  }

  throw new Error(`Preview health check failed for ${containerName}: ${lastObservedError}`);
}

export async function waitForContainerRunning(
  containerName: string,
  deps: ContainerRunningDeps,
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const runningTimeoutMs = deps.runningTimeoutMs ?? 15_000;
  const runningPollMs = deps.runningPollMs ?? 1_000;
  const requiredRunningPolls = deps.requiredRunningPolls ?? 2;
  const deadline = now() + runningTimeoutMs;

  let consecutiveRunningPolls = 0;
  let lastObservedError = "container did not become stably running";

  while (now() < deadline) {
    const inspect = await deps.inspectContainer(containerName);
    if (!inspect) {
      throw new Error(`Runtime container ${containerName} disappeared before startup confirmation`);
    }

    if (inspect.State?.Running) {
      consecutiveRunningPolls += 1;
      if (consecutiveRunningPolls >= requiredRunningPolls) {
        return;
      }
    } else {
      const stateDescription = inspect.State?.Status || "stopped";
      const exitCode = typeof inspect.State?.ExitCode === "number" ? inspect.State.ExitCode : "unknown";
      lastObservedError = `container is ${stateDescription} (exit ${exitCode})`;
      consecutiveRunningPolls = 0;
    }

    await sleep(runningPollMs);
  }

  throw new Error(`Runtime start check failed for ${containerName}: ${lastObservedError}`);
}

export async function waitForRunnerControlServing(
  containerName: string,
  deps: RunnerControlServingDeps,
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as PreviewFetch);
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const controlTimeoutMs = deps.controlTimeoutMs ?? 15_000;
  const controlPollMs = deps.controlPollMs ?? 1_000;
  const requiredSuccesses = deps.requiredSuccesses ?? 2;
  const deadline = now() + controlTimeoutMs;

  let consecutiveHealthyProbes = 0;
  let lastObservedError = "runner control plane did not become healthy";

  while (now() < deadline) {
    const inspect = await deps.inspectContainer(containerName);
    if (!inspect) {
      throw new Error(`Runtime container ${containerName} disappeared before runner control confirmation`);
    }

    if (!inspect.State?.Running) {
      const stateDescription = inspect.State?.Status || "stopped";
      const exitCode = typeof inspect.State?.ExitCode === "number" ? inspect.State.ExitCode : "unknown";
      lastObservedError = `container is ${stateDescription} (exit ${exitCode})`;
      consecutiveHealthyProbes = 0;
      await sleep(controlPollMs);
      continue;
    }

    const probe = await fetchPreviewEndpoint(`http://${containerName}:3999/__arena/preview-generation`, {
      fetchImpl,
      requestTimeoutMs: deps.requestTimeoutMs,
    });
    if (probe.ok) {
      consecutiveHealthyProbes += 1;
      if (consecutiveHealthyProbes >= requiredSuccesses) {
        return;
      }
    } else {
      consecutiveHealthyProbes = 0;
      lastObservedError = probe.error || `GET /__arena/preview-generation returned ${probe.status ?? "no response"}`;
    }

    await sleep(controlPollMs);
  }

  throw new Error(`Runner control check failed for ${containerName}: ${lastObservedError}`);
}

async function probePreviewServing(
  containerName: string,
  deps: {
    fetchImpl: PreviewFetch;
    requestTimeoutMs?: number;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const directBase = `http://${containerName}:3000`;

  const healthResponse = await fetchPreviewEndpoint(`${directBase}/health`, deps);
  if (healthResponse.ok) {
    return { ok: true };
  }

  if (healthResponse.status === 404) {
    const rootResponse = await fetchPreviewEndpoint(`${directBase}/`, deps);
    if (rootResponse.ok) {
      return { ok: true };
    }
    return { ok: false, error: rootResponse.error || `GET / returned ${rootResponse.status ?? "no response"}` };
  }

  return { ok: false, error: healthResponse.error || `GET /health returned ${healthResponse.status ?? "no response"}` };
}

async function fetchPreviewEndpoint(
  url: string,
  deps: {
    fetchImpl: PreviewFetch;
    requestTimeoutMs?: number;
  },
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await deps.fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(deps.requestTimeoutMs ?? 2_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
