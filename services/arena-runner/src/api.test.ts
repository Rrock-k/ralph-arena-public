import { afterEach, describe, expect, it, vi } from "vitest";

import { pushProgress, pushVisualEvidenceIngest, reportTerminalUntilAccepted } from "./api.js";

describe("runner governance api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports failed progress persistence to callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("busy", { status: 503 })));

    await expect(pushProgress({ eventType: "budget_debit", budgetDebitedUsd: 1 })).resolves.toBe(false);
  });

  it("reports successful progress persistence to callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    await expect(pushProgress({ eventType: "project_progress" })).resolves.toBe(true);
  });

  it("posts visual evidence ingest through the explicit runner endpoint", async () => {
    vi.stubEnv("ARENA_GOVERNANCE_URL", "http://governance.test");
    vi.stubEnv("ARENA_PROJECT_ID", "project-123");
    vi.stubEnv("ARENA_PROJECT_SECRET", "runner-secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      taskId: "task-1",
      sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
      progressJson: "{\"state\":\"completed\",\"steps\":[]}",
      artifactFilename: "capture.png",
      artifactContentType: "image/png",
      artifactContentBase64: Buffer.from("png").toString("base64"),
    };

    await expect(pushVisualEvidenceIngest(payload)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe("http://governance.test/api/internal/projects/project-123/visual-evidence-ingest");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-arena-project-secret": "runner-secret",
    });
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it("reports failed visual evidence ingest transport to callers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("digest mismatch", { status: 400 })));

    await expect(pushVisualEvidenceIngest({
      taskId: "task-1",
      sourceEvidenceRef: "visual-workbench-capture:synth-pad.playing.desktop:desktop:aaaaaaaaaaaa",
      progressJson: "{\"state\":\"completed\",\"steps\":[]}",
      artifactFilename: "capture.png",
      artifactContentType: "image/png",
      artifactContentBase64: Buffer.from("png").toString("base64"),
    })).resolves.toBe(false);
  });

  it("keeps retrying reliable terminal reports until governance accepts them", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reportTerminalUntilAccepted(
      {
        terminalState: "CANCELED",
        reasonCode: "resume_reclaim",
      },
      {
        context: "test_reclaim",
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    )).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats terminal 409 as already accepted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("already terminal", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reportTerminalUntilAccepted(
      {
        terminalState: "CANCELED",
        reasonCode: "resume_reclaim",
      },
      {
        context: "test_conflict",
        initialDelayMs: 0,
        maxDelayMs: 0,
      },
    )).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
