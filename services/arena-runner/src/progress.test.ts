import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

vi.mock("./api.js", () => ({
  pushProgress: vi.fn(),
  pushVisualEvidenceIngest: vi.fn(),
}));

import { readFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { pushProgress, pushVisualEvidenceIngest } from "./api.js";
import { ProgressWatcher } from "./progress.js";

describe("ProgressWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ state: "working" }) as any);
    vi.mocked(pushProgress).mockResolvedValue(true);
    vi.mocked(pushVisualEvidenceIngest).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for in-flight progress pushes before stopAndDrain resolves", async () => {
    let resolvePush: (() => void) | null = null;
    vi.mocked(pushProgress).mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolvePush = () => resolve(true);
    }));
    vi.mocked(pushProgress).mockResolvedValue(true);

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);
    expect(pushProgress).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopPromise = (watcher as any).stopAndDrain().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);

    resolvePush?.();
    await stopPromise;

    expect(stopped).toBe(true);
    expect(pushProgress).toHaveBeenCalledTimes(2);
  });

  it("flushes the latest progress snapshot during stopAndDrain", async () => {
    vi.mocked(pushProgress).mockResolvedValue(true);
    vi.mocked(readFileSync)
      .mockReturnValueOnce(JSON.stringify({ state: "coding" }) as any)
      .mockReturnValue(JSON.stringify({ state: "completed" }) as any);

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);
    await watcher.stopAndDrain();

    expect(pushProgress).toHaveBeenNthCalledWith(1, {
      eventType: "project_progress",
      progressJson: JSON.stringify({ state: "coding" }),
    });
    expect(pushProgress).toHaveBeenNthCalledWith(2, {
      eventType: "project_progress",
      progressJson: JSON.stringify({ state: "completed" }),
    });
    expect(watcher.getLastState()).toBe("completed");
  });

  it("includes serving preview truth in project-progress pushes when the runner sidecar is healthy", async () => {
    const watcher = new ProgressWatcher("/tmp/workdir", {
      getPreviewActual: () => "SERVING",
    });
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);

    expect(pushProgress).toHaveBeenCalledWith({
      eventType: "project_progress",
      progressJson: JSON.stringify({ state: "working" }),
      previewActual: "SERVING",
    });
  });

  it("forwards explicit Mini App entrypoint from progress custom fields", async () => {
    const progressJson = JSON.stringify({
      state: "working",
      custom: {
        telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
      },
    });
    vi.mocked(readFileSync).mockReturnValue(progressJson as any);
    vi.mocked(pushProgress).mockResolvedValue(true);

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);

    expect(pushProgress).toHaveBeenCalledWith({
      eventType: "project_progress",
      progressJson,
      telegramMiniAppUrl: "https://t.me/sample_bot/sampleapp?startapp=done",
    });
  });

  it("pushes an explicit null progress payload when progress file is absent", async () => {
    const enoent = Object.assign(new Error("missing progress"), { code: "ENOENT" });
    vi.mocked(readFileSync).mockImplementation(() => {
      throw enoent;
    });
    vi.mocked(pushProgress).mockResolvedValue(true);

    const watcher = new ProgressWatcher("/tmp/workdir", {
      getPreviewActual: () => "SERVING",
    });
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);

    expect(pushProgress).toHaveBeenCalledWith({
      eventType: "project_progress",
      progressJson: null,
      previewActual: "SERVING",
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(pushProgress).toHaveBeenCalledTimes(1);
  });

  it("preserves the last observed progress payload when the file disappears mid-run", async () => {
    const enoent = Object.assign(new Error("missing progress"), { code: "ENOENT" });
    const progressJson = JSON.stringify({ state: "coding", iteration: 3 });
    vi.mocked(readFileSync)
      .mockReturnValueOnce(progressJson as any)
      .mockImplementation(() => {
        throw enoent;
      });
    vi.mocked(pushProgress).mockResolvedValue(true);

    const watcher = new ProgressWatcher("/tmp/workdir", {
      getPreviewActual: () => "SERVING",
    });
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(pushProgress).toHaveBeenNthCalledWith(1, {
      eventType: "project_progress",
      progressJson,
      previewActual: "SERVING",
    });
    expect(pushProgress).toHaveBeenNthCalledWith(2, {
      eventType: "project_progress",
      progressJson,
      previewActual: "SERVING",
    });
    expect(watcher.getLastSnapshot()).toEqual({ state: "coding", message: null });

    await vi.advanceTimersByTimeAsync(5000);
    expect(pushProgress).toHaveBeenCalledTimes(2);
  });

  it("fires iteration callback only when a later observed iteration advances", async () => {
    const onIterationAdvanced = vi.fn();
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ state: "deploying", iteration: 1 }) as any);

    const watcher = new ProgressWatcher("/tmp/workdir", {
      onIterationAdvanced,
    });
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);
    expect(onIterationAdvanced).not.toHaveBeenCalled();

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ state: "deploying", iteration: 2 }) as any);
    await vi.advanceTimersByTimeAsync(5000);

    expect(onIterationAdvanced).toHaveBeenCalledTimes(1);
    expect(onIterationAdvanced).toHaveBeenCalledWith(2);
  });

  it("pushes explicit visual evidence ingest manifest entries after current progress persists", async () => {
    const calls: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const artifact = Buffer.from("fake-workbench-png");
    const artifactSha256 = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;
    const sourceEvidenceRef = "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa";
    const progressJson = JSON.stringify({
      state: "coding",
      steps: [{
        id: "task-001",
        visualEvidence: [{
          sourceEvidenceRef,
          artifactSha256,
        }],
      }],
    });
    const manifestJson = JSON.stringify({
      schemaVersion: "ra-356.visual-evidence-ingest-manifest.v1",
      items: [{
        taskId: "task-001",
        sourceEvidenceRef,
        artifactPath: ".ralph/visual-workbench/synth-pad.playing.desktop/desktop/aaaaaaaaaaaa.png",
        artifactSha256,
        artifactContentType: "image/png",
      }],
    });
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      const file = String(filePath);
      if (file.endsWith(join(".arena", "progress.json"))) return progressJson as any;
      if (file.endsWith(join(".arena", "visual-evidence-ingest-manifest.json"))) return manifestJson as any;
      if (file.endsWith(join(".ralph", "visual-workbench", "synth-pad.playing.desktop", "desktop", "aaaaaaaaaaaa.png"))) {
        return artifact as any;
      }
      throw Object.assign(new Error(`unexpected file ${file}`), { code: "ENOENT" });
    });
    vi.mocked(pushProgress).mockImplementationOnce(async () => {
      calls.push("progress");
      return true;
    });
    vi.mocked(pushVisualEvidenceIngest).mockImplementationOnce(async () => {
      calls.push("visual");
      return true;
    });

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);

    expect(calls).toEqual(["progress", "visual"]);
    expect(pushVisualEvidenceIngest).toHaveBeenCalledWith({
      taskId: "task-001",
      sourceEvidenceRef,
      progressJson,
      artifactFilename: "aaaaaaaaaaaa.png",
      artifactContentType: "image/png",
      artifactContentBase64: artifact.toString("base64"),
    });
    expect(logSpy).toHaveBeenCalledWith(
      `[runner] visual evidence ingest accepted: taskId=task-001 sourceEvidenceRef=${sourceEvidenceRef} artifactSha256=${artifactSha256}`,
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(pushVisualEvidenceIngest).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  it("does not ingest manifest entries missing from the current progress snapshot", async () => {
    const artifact = Buffer.from("fake-workbench-png");
    const artifactSha256 = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      const file = String(filePath);
      if (file.endsWith(join(".arena", "progress.json"))) {
        return JSON.stringify({ state: "coding", steps: [{ id: "task-001", visualEvidence: [] }] }) as any;
      }
      if (file.endsWith(join(".arena", "visual-evidence-ingest-manifest.json"))) {
        return JSON.stringify({
          schemaVersion: "ra-356.visual-evidence-ingest-manifest.v1",
          items: [{
            taskId: "task-001",
            sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
            artifactPath: ".ralph/visual-workbench/synth-pad.playing.desktop/desktop/aaaaaaaaaaaa.png",
            artifactSha256,
            artifactContentType: "image/png",
          }],
        }) as any;
      }
      return artifact as any;
    });
    vi.mocked(pushProgress).mockResolvedValue(true);

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});
    await vi.advanceTimersByTimeAsync(5000);

    expect(pushVisualEvidenceIngest).not.toHaveBeenCalled();
  });

  it("does not ingest when artifact digest mismatches the manifest", async () => {
    const artifact = Buffer.from("fake-workbench-png");
    const manifestSha256 = `sha256:${"a".repeat(64)}`;
    const sourceEvidenceRef = "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa";
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      const file = String(filePath);
      if (file.endsWith(join(".arena", "progress.json"))) {
        return JSON.stringify({
          state: "coding",
          steps: [{
            id: "task-001",
            visualEvidence: [{ sourceEvidenceRef, artifactSha256: manifestSha256 }],
          }],
        }) as any;
      }
      if (file.endsWith(join(".arena", "visual-evidence-ingest-manifest.json"))) {
        return JSON.stringify({
          schemaVersion: "ra-356.visual-evidence-ingest-manifest.v1",
          items: [{
            taskId: "task-001",
            sourceEvidenceRef,
            artifactPath: ".ralph/visual-workbench/synth-pad.playing.desktop/desktop/aaaaaaaaaaaa.png",
            artifactSha256: manifestSha256,
            artifactContentType: "image/png",
          }],
        }) as any;
      }
      return artifact as any;
    });
    vi.mocked(pushProgress).mockResolvedValue(true);

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});
    await vi.advanceTimersByTimeAsync(5000);

    expect(pushVisualEvidenceIngest).not.toHaveBeenCalled();
  });

  it("does not read or upload unsafe manifest artifact paths", async () => {
    const artifactSha256 = `sha256:${"a".repeat(64)}`;
    const sourceEvidenceRef = "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa";
    let artifactReads = 0;
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      const file = String(filePath);
      if (file.endsWith(join(".arena", "progress.json"))) {
        return JSON.stringify({
          state: "coding",
          steps: [{
            id: "task-001",
            visualEvidence: [{ sourceEvidenceRef, artifactSha256 }],
          }],
        }) as any;
      }
      if (file.endsWith(join(".arena", "visual-evidence-ingest-manifest.json"))) {
        return JSON.stringify({
          schemaVersion: "ra-356.visual-evidence-ingest-manifest.v1",
          items: [{
            taskId: "task-001",
            sourceEvidenceRef,
            artifactPath: ".ralph/visual-workbench/story/../secret.png",
            artifactSha256,
            artifactContentType: "image/png",
          }],
        }) as any;
      }
      artifactReads += 1;
      return Buffer.from("should-not-read") as any;
    });
    vi.mocked(pushProgress).mockResolvedValue(true);

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});
    await vi.advanceTimersByTimeAsync(5000);

    expect(artifactReads).toBe(0);
    expect(pushVisualEvidenceIngest).not.toHaveBeenCalled();
  });

  it("backs off failed visual evidence uploads before retrying", async () => {
    const artifact = Buffer.from("fake-workbench-png");
    const artifactSha256 = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;
    const sourceEvidenceRef = "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa";
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      const file = String(filePath);
      if (file.endsWith(join(".arena", "progress.json"))) {
        return JSON.stringify({
          state: "coding",
          steps: [{
            id: "task-001",
            visualEvidence: [{ sourceEvidenceRef, artifactSha256 }],
          }],
        }) as any;
      }
      if (file.endsWith(join(".arena", "visual-evidence-ingest-manifest.json"))) {
        return JSON.stringify({
          schemaVersion: "ra-356.visual-evidence-ingest-manifest.v1",
          items: [{
            taskId: "task-001",
            sourceEvidenceRef,
            artifactPath: ".ralph/visual-workbench/synth-pad.playing.desktop/desktop/aaaaaaaaaaaa.png",
            artifactSha256,
            artifactContentType: "image/png",
          }],
        }) as any;
      }
      return artifact as any;
    });
    vi.mocked(pushProgress).mockResolvedValue(true);
    vi.mocked(pushVisualEvidenceIngest)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});

    await vi.advanceTimersByTimeAsync(5000);
    expect(pushVisualEvidenceIngest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(pushVisualEvidenceIngest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(pushVisualEvidenceIngest).toHaveBeenCalledTimes(2);
  });

  it("does not ingest manifest entries when ordinary progress persistence fails", async () => {
    vi.mocked(pushProgress).mockResolvedValue(false);
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      const file = String(filePath);
      if (file.endsWith(join(".arena", "progress.json"))) {
        return JSON.stringify({
          state: "coding",
          steps: [{
            id: "task-001",
            visualEvidence: [{
              sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
              artifactSha256: `sha256:${"a".repeat(64)}`,
            }],
          }],
        }) as any;
      }
      throw Object.assign(new Error(`unexpected file ${file}`), { code: "ENOENT" });
    });

    const watcher = new ProgressWatcher("/tmp/workdir");
    watcher.start(() => {});
    await vi.advanceTimersByTimeAsync(5000);

    expect(pushVisualEvidenceIngest).not.toHaveBeenCalled();
  });
});
