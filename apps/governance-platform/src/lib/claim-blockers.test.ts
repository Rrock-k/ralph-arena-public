import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  requirePrimaryComponentRow: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

import {
  applyStateChange,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";
import { parkAgentBlocked } from "@/lib/claim-blockers";

describe("parkAgentBlocked", () => {
  it("keeps runner ownership for agent transition but bridges blocker writes through system", async () => {
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: null,
      previewUrl: null,
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    await parkAgentBlocked({} as Prisma.TransactionClient, "proj-1", "RATE_LIMIT", "rate limited", "terminal_pause", {
      source: "runner",
      diagnostics: {
        terminalForensics: {
          exitCode: 137,
          signal: "SIGKILL",
        },
      },
    });

    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "proj-1",
      { type: "agentTransition", state: "IDLE" },
      expect.objectContaining({
        source: "runner",
        trigger: "terminal_pause",
        diagnostics: {
          terminalForensics: {
            exitCode: 137,
            signal: "SIGKILL",
          },
        },
      }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "RATE_LIMIT" },
      expect.objectContaining({ source: "system", trigger: "terminal_pause" }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({ retryCount: 1 }),
      expect.objectContaining({ source: "runner", trigger: "terminal_pause" }),
    );
  });
});
