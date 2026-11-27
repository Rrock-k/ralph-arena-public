import type { ArenaCtlConfig } from "./config.js";

export class WorkerClient {
  constructor(private readonly config: ArenaCtlConfig) {}

  getContainerLogs(workerUrl: string, containerName: string, tail = 500) {
    return this.getJson(`${workerUrl}/containers/${encodeURIComponent(containerName)}/logs?tail=${encodeURIComponent(String(tail))}`);
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: this.config.workerSecret
        ? { "x-worker-secret": this.config.workerSecret }
        : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const raw = await response.text();
    const data = parseJson(raw);

    if (!response.ok) {
      const error = typeof data === "object" && data && "error" in data
        ? String((data as { error?: unknown }).error || `HTTP ${response.status}`)
        : `Worker request failed (${response.status})`;
      throw new Error(error);
    }

    return data as T;
  }
}

function parseJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
