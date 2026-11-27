import { describe, expect, it } from "vitest";

import {
  buildIdlePreviewExitedReport,
  buildIdleResumeReclaimReport,
  buildPausedRuntimeShutdownReport,
} from "./idle-reclaim.js";

describe("buildIdleResumeReclaimReport", () => {
  it("builds a reclaim terminal report that tears runtime down without inventing completion", () => {
    expect(buildIdleResumeReclaimReport()).toEqual({
      terminalState: "CANCELED",
      reasonCode: "resume_reclaim",
      reasonMessage: "Idle preview yielded runtime so governance can reclaim and resume work.",
      containerName: null,
      workerHost: null,
    });
  });

  it("accepts a custom reason message for operator-facing traces", () => {
    expect(buildIdleResumeReclaimReport("Paused preview is yielding to a fresh claim.")).toEqual({
      terminalState: "CANCELED",
      reasonCode: "resume_reclaim",
      reasonMessage: "Paused preview is yielding to a fresh claim.",
      containerName: null,
      workerHost: null,
    });
  });

  it("builds a graceful idle-preview exit report that clears stale runtime truth", () => {
    expect(buildIdlePreviewExitedReport()).toEqual({
      terminalState: "CANCELED",
      reasonCode: "idle_preview_exited",
      reasonMessage: "Idle preview exited unexpectedly; governance should restore project truth through the normal claim path.",
      containerName: null,
      workerHost: null,
    });
  });

  it("builds a paused-runtime shutdown report that clears stale runtime truth", () => {
    expect(buildPausedRuntimeShutdownReport()).toEqual({
      terminalState: "CANCELED",
      reasonCode: "paused_runtime_shutdown",
      reasonMessage: "Paused runtime shut down after governance requested shutdown.",
      containerName: null,
      workerHost: null,
    });
  });
});
