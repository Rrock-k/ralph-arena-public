import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildPreviewServiceWorkerWrapper, createPreviewGenerationState, PREVIEW_NO_STORE_HEADERS, startPreviewControlServer } from "./preview-service-worker.js";

describe("preview service worker wrapper", () => {
  it("embeds the preview generation so browser update checks see commit changes", () => {
    const script = buildPreviewServiceWorkerWrapper("abc123");

    expect(script).toContain('const ARENA_PREVIEW_GENERATION = "abc123";');
    expect(script).toContain("/__arena/project-sw.js?arena_generation=abc123");
    expect(script).toContain("importScripts");
  });

  it("keeps runner-owned preview control responses out of browser and CDN caches", () => {
    expect(PREVIEW_NO_STORE_HEADERS).toEqual({
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
    });
  });

  it("claims and refreshes open preview clients after a generation update", () => {
    const script = buildPreviewServiceWorkerWrapper("abc123");

    expect(script).toContain("async function clearArenaPreviewCaches()");
    expect(script).toContain("self.caches.keys()");
    expect(script).toContain("self.caches.delete(cacheName)");
    expect(script.indexOf("await clearArenaPreviewCaches()")).toBeLessThan(script.indexOf("await self.clients.claim()"));
    expect(script).toContain("self.clients.claim()");
    expect(script).toContain('self.clients.matchAll({ type: "window", includeUncontrolled: true })');
    expect(script).toContain("client.navigate(client.url)");
  });

  it("escapes generation values before putting them into JavaScript", () => {
    const script = buildPreviewServiceWorkerWrapper('sha"with spaces');

    expect(script).toContain('const ARENA_PREVIEW_GENERATION = "sha\\"with spaces";');
    expect(script).toContain("sha%22with%20spaces");
  });

  it("waits for the internal preview refresh handler before responding", async () => {
    const calls: string[] = [];
    const server = startPreviewControlServer({
      workspaceDir: "/tmp",
      port: 0,
      refreshPreview: async (trigger) => {
        calls.push(trigger);
        return { previewActual: "SERVING" };
      },
    });

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/__arena/internal/refresh-preview?trigger=test_refresh`, {
        method: "POST",
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ previewActual: "SERVING" });
      expect(calls).toEqual(["test_refresh"]);
      expect(response.headers.get("cache-control")).toBe(PREVIEW_NO_STORE_HEADERS["Cache-Control"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("advances and persists generation only after serving is confirmed", () => {
    const root = mkdtempSync(join(tmpdir(), "arena-preview-generation-"));
    const stateFile = join(root, "state", "generation.json");

    try {
      const state = createPreviewGenerationState({ workspaceDir: root, stateFile });
      const before = state.getSnapshot();
      expect(before.sequence).toBe(0);

      const firstServing = state.markServing();
      expect(firstServing.sequence).toBe(1);
      expect(firstServing.generation).not.toBe(before.generation);

      const restored = createPreviewGenerationState({ workspaceDir: root, stateFile });
      expect(restored.getSnapshot()).toEqual(firstServing);

      const secondServing = restored.markServing();
      expect(secondServing.sequence).toBe(2);
      expect(secondServing.generation).not.toBe(firstServing.generation);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the public generation response backward compatible", async () => {
    const generationState = {
      getSnapshot: () => ({
        generation: "commit:refresh-7",
        sequence: 7,
        sourceGeneration: "commit",
      }),
      markServing: () => {
        throw new Error("not expected");
      },
    };
    const server = startPreviewControlServer({
      workspaceDir: process.cwd(),
      port: 0,
      generationState,
    });

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");

      const response = await fetch("http://127.0.0.1:" + address.port + "/__arena/preview-generation");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ generation: "commit:refresh-7" });
      expect(response.headers.get("x-arena-preview-generation")).toBe("commit:refresh-7");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

});
