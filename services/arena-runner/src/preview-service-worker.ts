import { createServer, type Server } from "http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { getCommitSha, isGitRepo } from "./git.js";

const DEFAULT_PREVIEW_CONTROL_PORT = 3999;
export const PREVIEW_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
};

export type PreviewRefreshResult = {
  previewActual: "SERVING" | "ERROR";
  reasonCode?: string;
  reasonMessage?: string;
};

export type PreviewGenerationSnapshot = {
  generation: string;
  sequence: number;
  sourceGeneration: string;
};

export type PreviewGenerationState = {
  getSnapshot(): PreviewGenerationSnapshot;
  markServing(): PreviewGenerationSnapshot;
};

type PersistedPreviewGeneration = {
  sequence: number;
  sourceGeneration: string;
};

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function resolvePreviewGeneration(workspaceDir: string): string {
  if (isGitRepo(workspaceDir)) {
    const commitSha = getCommitSha(workspaceDir);
    if (commitSha) return commitSha;
  }

  return [
    "no-git",
    process.env.ARENA_PROJECT_ID || "unknown-project",
    process.env.ARENA_RUNNER_VERSION || "unknown-runner",
  ].join(":");
}

function readPersistedGeneration(stateFile: string | undefined): PersistedPreviewGeneration | null {
  if (!stateFile) return null;
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<PersistedPreviewGeneration>;
    if (!Number.isSafeInteger(parsed.sequence) || Number(parsed.sequence) < 0) return null;
    if (typeof parsed.sourceGeneration !== "string" || !parsed.sourceGeneration) return null;
    return {
      sequence: Number(parsed.sequence),
      sourceGeneration: parsed.sourceGeneration,
    };
  } catch {
    return null;
  }
}

function persistGeneration(stateFile: string | undefined, value: PersistedPreviewGeneration): void {
  if (!stateFile) return;
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, stateFile);
  } catch (error) {
    console.warn(
      "[runner] Failed to persist preview generation:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function buildSnapshot(value: PersistedPreviewGeneration): PreviewGenerationSnapshot {
  return {
    generation: `${value.sourceGeneration}:refresh-${value.sequence}`,
    sequence: value.sequence,
    sourceGeneration: value.sourceGeneration,
  };
}

export function createPreviewGenerationState(options: {
  workspaceDir: string;
  stateFile?: string;
}): PreviewGenerationState {
  let value = readPersistedGeneration(options.stateFile) ?? {
    sequence: 0,
    sourceGeneration: resolvePreviewGeneration(options.workspaceDir),
  };

  return {
    getSnapshot() {
      return buildSnapshot(value);
    },
    markServing() {
      value = {
        sequence: value.sequence + 1,
        sourceGeneration: resolvePreviewGeneration(options.workspaceDir),
      };
      persistGeneration(options.stateFile, value);
      return buildSnapshot(value);
    },
  };
}

export function buildPreviewServiceWorkerWrapper(generation: string): string {
  const generationLiteral = JSON.stringify(generation);
  const projectSwPathLiteral = JSON.stringify(`/__arena/project-sw.js?arena_generation=${encodeURIComponent(generation)}`);

  return `// Arena preview service worker wrapper.
// This script changes only after a preview process has started and passed its health check.
// It preserves the project's own service worker while forcing browser SW update checks
// to see a new script for each confirmed preview generation.
const ARENA_PREVIEW_GENERATION = ${generationLiteral};
self.__ARENA_PREVIEW_GENERATION = ARENA_PREVIEW_GENERATION;

async function clearArenaPreviewCaches() {
  if (!self.caches) return;

  const cacheNames = await self.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => self.caches.delete(cacheName)));
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await clearArenaPreviewCaches();
    await self.clients.claim();

    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(clients.map((client) => {
      try {
        const url = new URL(client.url);
        if (url.origin !== self.location.origin) return undefined;
        if (url.pathname.startsWith("/__arena/")) return undefined;
        return client.navigate(client.url);
      } catch {
        return undefined;
      }
    }));
  })());
});

try {
  importScripts(${projectSwPathLiteral});
} catch (error) {
  console.warn("[arena-preview] Project service worker import failed:", error);
}
`;
}

export function startPreviewControlServer(options: {
  workspaceDir: string;
  port?: number;
  generationState?: PreviewGenerationState;
  refreshPreview?: (trigger: string) => Promise<PreviewRefreshResult>;
}): Server {
  const port = options.port ?? Number(process.env.ARENA_PREVIEW_CONTROL_PORT || DEFAULT_PREVIEW_CONTROL_PORT);
  const generationState = options.generationState ?? createPreviewGenerationState({
    workspaceDir: options.workspaceDir,
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://arena-preview.local");

    if (url.pathname === "/sw.js" || url.pathname === "/__arena/sw.js") {
      const current = generationState.getSnapshot();
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        ...PREVIEW_NO_STORE_HEADERS,
        "X-Arena-Preview-Generation": current.generation,
      });
      res.end(buildPreviewServiceWorkerWrapper(current.generation));
      return;
    }

    if (url.pathname === "/__arena/preview-generation") {
      const current = generationState.getSnapshot();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        ...PREVIEW_NO_STORE_HEADERS,
        "X-Arena-Preview-Generation": current.generation,
      });
      res.end(JSON.stringify({ generation: current.generation }));
      return;
    }

    if (url.pathname === "/__arena/internal/refresh-preview") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) {
        res.writeHead(403, {
          "Content-Type": "application/json; charset=utf-8",
          ...PREVIEW_NO_STORE_HEADERS,
        });
        res.end(JSON.stringify({
          previewActual: "ERROR",
          reasonCode: "loopback_required",
          reasonMessage: "Preview refresh is only available from the local runner container.",
        }));
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405, {
          "Content-Type": "application/json; charset=utf-8",
          Allow: "POST",
          ...PREVIEW_NO_STORE_HEADERS,
        });
        res.end(JSON.stringify({
          previewActual: "ERROR",
          reasonCode: "method_not_allowed",
          reasonMessage: "Use POST to refresh preview.",
        }));
        return;
      }

      if (!options.refreshPreview) {
        res.writeHead(503, {
          "Content-Type": "application/json; charset=utf-8",
          ...PREVIEW_NO_STORE_HEADERS,
        });
        res.end(JSON.stringify({
          previewActual: "ERROR",
          reasonCode: "preview_refresh_unavailable",
          reasonMessage: "Preview refresh handler is not ready.",
        }));
        return;
      }

      const trigger = url.searchParams.get("trigger") || "internal_refresh";
      void options.refreshPreview(trigger)
        .then((result) => {
          res.writeHead(result.previewActual === "SERVING" ? 200 : 503, {
            "Content-Type": "application/json; charset=utf-8",
            ...PREVIEW_NO_STORE_HEADERS,
          });
          res.end(JSON.stringify(result));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(500, {
            "Content-Type": "application/json; charset=utf-8",
            ...PREVIEW_NO_STORE_HEADERS,
          });
          res.end(JSON.stringify({
            previewActual: "ERROR",
            reasonCode: "preview_refresh_error",
            reasonMessage: message,
          }));
        });
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      ...PREVIEW_NO_STORE_HEADERS,
    });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[runner] Preview control server listening on :${port}`);
  });

  return server;
}
