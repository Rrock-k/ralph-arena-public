import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("./project-audit", () => ({
  runProjectAudit: vi.fn(),
}));

vi.mock("./control-plane", () => ({
  getProjectState: vi.fn(),
  getWorkerSnapshot: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));
import { existsSync } from "node:fs";
import { getProjectState, getWorkerSnapshot } from "./control-plane";
import { prisma } from "./prisma";
import { runProjectAudit } from "./project-audit";
import {
  diagnoseRecoverySnapshot,
  loadRecoverySnapshot,
} from "./project-recovery";
import type { RecoverySnapshot } from "./project-recovery-types";

function makeSnapshot(overrides?: Partial<RecoverySnapshot>): RecoverySnapshot {
  const base: RecoverySnapshot = {
    archivedAt: null,
    component: {
      id: "comp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      retryAt: null,
      retryCount: 0,
      provisionedAt: null,
      previewHealth: "HEALTHY",
      previewUrl: "https://demo.example.com",
      containerName: "preview-demo",
      workerHost: "local",
    },
    worker: {
      workerUrl: "http://worker.local",
      inspectStatus: "running",
      parityStatus: "clean",
      parityReasons: [],
      actionableParityReasons: [],
      runtimeGenerationStatus: "clean",
      runtimeGenerationReasons: [],
      actionableRuntimeGenerationReasons: [],
    },
    previewReachability: {
      classification: "reachable",
      status: 200,
    },
  };

  return {
    ...base,
    ...overrides,
    component: { ...base.component, ...overrides?.component },
    worker: { ...base.worker, ...overrides?.worker },
    previewReachability: { ...base.previewReachability, ...overrides?.previewReachability },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback({
    project: { update: vi.fn().mockResolvedValue({}) },
    projectComponent: { update: vi.fn().mockResolvedValue({}) },
    runLog: { create: vi.fn().mockResolvedValue({}) },
  }));
  vi.mocked(runProjectAudit).mockResolvedValue({
    projects: [{
      projectId: "proj-1",
      violations: [],
    }],
  } as any);
  vi.mocked(existsSync).mockImplementation((target: any) => {
    const value = String(target);
    return value.endsWith("/demo") || value.endsWith("/demo/.git");
  });
});

function mockProjectHealth(project: unknown, worker: unknown) {
  vi.mocked(getProjectState).mockResolvedValue(project as any);
  vi.mocked(getWorkerSnapshot).mockResolvedValue(worker as any);
}

describe("diagnoseRecoverySnapshot", () => {
  it("marks healthy completed previews as healthy with no action", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot());
    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
  });

  it("marks healthy parked preview-only rows as healthy with no action", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentIntent: "OFF",
        lastOutcome: null,
        previewUrl: null,
        previewHealth: "UNKNOWN",
      },
    }));
    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
  });

  it("does not treat worker-service generation drift on retained previews as project recovery work", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentIntent: "OFF",
        agentState: "IDLE",
        lastOutcome: null,
      },
      worker: {
        parityStatus: "mismatch",
        parityReasons: [
          "worker_sha_mismatch:cb36fb16fa4c",
          "runner_sha_mismatch:cb36fb16fa4c",
        ],
        actionableParityReasons: [
          "worker_sha_mismatch:cb36fb16fa4c",
          "runner_sha_mismatch:cb36fb16fa4c",
        ],
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).not.toContain(expect.stringContaining("worker service generation drift:"));
  });

  it("routes actionable project runtime generation drift to recreate_runtime on retained previews", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentIntent: "OFF",
        agentState: "IDLE",
        lastOutcome: null,
      },
      worker: {
        runtimeGenerationStatus: "mismatch",
        runtimeGenerationReasons: ["runtime_runner_version_mismatch:cb36fb16fa4c"],
        actionableRuntimeGenerationReasons: ["runtime_runner_version_mismatch:cb36fb16fa4c"],
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("recreate_runtime");
    expect(diagnosis.mismatches).toContain(
      "runtime generation drift: runtime_runner_version_mismatch:cb36fb16fa4c",
    );
  });

  it("does not treat incomplete runtime generation truth as actionable maintenance drift", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentIntent: "OFF",
        agentState: "IDLE",
        lastOutcome: null,
      },
      worker: {
        runtimeGenerationStatus: "mismatch",
        runtimeGenerationReasons: ["runtime_runner_version_missing"],
        actionableRuntimeGenerationReasons: [],
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).not.toContain(expect.stringContaining("runtime generation drift:"));
  });

  it("does not flag auth-gated preview reachability as broken on healthy previews", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      previewReachability: {
        classification: "auth_gated",
        status: 403,
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).toEqual([]);
  });

  it("still flags non-auth reachability failures on running previews", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      previewReachability: {
        classification: "down",
        status: 503,
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).toContain("preview is down while runtimeState=RUNNING (status=503)");
  });

  it("carves out live auth-gated rows with RUNNING + COMPLETED as usable instead of needs_recovery", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentState: "RUNNING",
        previewHealth: "HEALTHY",
      },
      previewReachability: {
        classification: "auth_gated",
        status: 403,
      },
      worker: {
        inspectStatus: "running",
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).toEqual([]);
  });

  it("carves out live local previews that are still running while health metadata is unsettled", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentState: "RUNNING",
        lastOutcome: null,
        previewHealth: "UNKNOWN",
        previewUrl: "http://preview-demo.localhost:8080",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
      },
      worker: {
        inspectStatus: "running",
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).toEqual([]);
  });

  it("treats waiting-by-blocker live previews as healthy rather than recovery debt", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentState: "IDLE",
        blockers: ["RATE_LIMIT"],
        lastOutcome: null,
        previewHealth: "HEALTHY",
      },
      previewReachability: {
        classification: "auth_gated",
        status: 403,
      },
      worker: {
        inspectStatus: "running",
      },
    }));

    expect(diagnosis.cohort).toBe("healthy");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).toEqual([]);
  });

  it("keeps local running previews in needs_recovery when preview health is explicitly unhealthy", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentState: "RUNNING",
        lastOutcome: null,
        previewHealth: "UNHEALTHY",
        previewUrl: "http://preview-demo.localhost:8080",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
      },
      worker: {
        inspectStatus: "running",
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.suggestedAction).toBe("recreate_runtime");
  });

  it("explains resident idle rows that lost runtime", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: null,
        previewHealth: "UNKNOWN",
        previewUrl: null,
        containerName: null,
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        url: null,
        status: null,
        error: null,
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.mismatches).toContain("agentIntent=ON + agentState=IDLE + blockers=[] but runtimeState=ABSENT");
  });

  it("keeps RUNNING + COMPLETED rows in needs_recovery when live preview proof is missing", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        agentState: "RUNNING",
        previewHealth: "HEALTHY",
      },
      previewReachability: {
        classification: "down",
        status: 503,
        error: null,
      },
      worker: {
        inspectStatus: "running",
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.suggestedAction).toBe("recreate_runtime");
  });

  it("recognizes parked valid completed projects", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        lastOutcome: "COMPLETED",
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
        error: "No preview URL",
      },
    }));

    expect(diagnosis.cohort).toBe("parked");
    expect(diagnosis.suggestedAction).toBe("none");
  });

  it("does not treat blockers as a paused-only recovery mismatch", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
        error: "No preview URL",
      },
    }));

    expect(diagnosis.cohort).toBe("parked");
    expect(diagnosis.suggestedAction).toBe("none");
    expect(diagnosis.mismatches).toEqual([]);
  });

  it("treats parked failed-history rows as valid parked state, not recovery debt", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        lastOutcome: "FAILED",
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
        error: "No preview URL",
      },
    }));

    expect(diagnosis.cohort).toBe("parked");
    expect(diagnosis.suggestedAction).toBe("none");
  });

  it("does not treat parked failed rows with live FAILED state as valid parked state", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "FAILED",
        lastOutcome: "FAILED",
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
        error: "No preview URL",
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.suggestedAction).toBe("recreate_runtime");
  });

  it("routes completed powered-on runtime loss to preview_restore", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        lastOutcome: "COMPLETED",
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
        error: "connect ECONNREFUSED",
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.suggestedAction).toBe("preview_restore");
  });

  it("routes failed-history runtime loss to preview_restore when no new loop work is implied", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        lastOutcome: "FAILED",
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
        error: "connect ECONNREFUSED",
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.suggestedAction).toBe("preview_restore");
  });

  it("does not treat stale RUNNING row as healthy when the worker reports the container stopped", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        lastOutcome: "FAILED",
        previewHealth: "HEALTHY",
        previewUrl: "https://demo.example.com",
        containerName: "preview-demo",
      },
      worker: {
        inspectStatus: "stopped",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.suggestedAction).toBe("preview_restore");
  });

  it("routes parked preview-only runtime loss to preview_restore without requiring COMPLETED", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        lastOutcome: null,
      },
      worker: {
        inspectStatus: "not_found",
      },
      previewReachability: {
        classification: "unreachable",
        status: null,
        error: "connect ECONNREFUSED",
      },
    }));

    expect(diagnosis.cohort).toBe("needs_recovery");
    expect(diagnosis.suggestedAction).toBe("preview_restore");
  });

  it("routes null-shaped rows to recreate_runtime territory", () => {
    const diagnosis = diagnoseRecoverySnapshot(makeSnapshot({
      component: {
        powerIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: null,
        lastOutcome: null,
        blockers: [],
      },
      worker: {
        workerUrl: null,
        inspectStatus: "missing_worker",
      },
    }));

    expect(diagnosis.cohort).toBe("garbage");
    expect(diagnosis.suggestedAction).toBe("recreate_runtime");
  });
});

describe("loadRecoverySnapshot", () => {
  it("returns the reduced recovery snapshot without redundant project identity ballast", async () => {
    mockProjectHealth({
        id: "proj-1",
        name: "Demo",
        archivedAt: null,
        previewUrl: null,
        containerName: null,
        workerHost: "local",
        lastError: null,
        startedAt: null,
        finishedAt: null,
        runLogs: [],
        components: [{
          id: "comp-1",
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: ["INFRA"],
          lastOutcome: "FAILED",
          retryAt: new Date("2026-04-17T09:00:00.000Z"),
          retryCount: 2,
          provisionedAt: new Date("2026-04-17T08:00:00.000Z"),
          previewHealth: "UNKNOWN",
          previewUrl: null,
          containerName: null,
          workerHost: "local",
        }],
      }, {
        workerUrl: "http://worker.local",
        inspect: { status: "not_found" },
        logs: null,
        parity: {
          status: "mismatch",
          reasons: ["worker_sha_mismatch:cb36fb16fa4c", "expected_commit_missing"],
        },
        runtimeGeneration: {
          status: "mismatch",
          reasons: ["runtime_runner_version_mismatch:cb36fb16fa4c"],
        },
      });
    const snapshot = await loadRecoverySnapshot("proj-1");

    expect(snapshot).not.toBeNull();
    expect(snapshot).not.toHaveProperty("runtimeIntents");
    expect(snapshot?.component.retryAt).toBe("2026-04-17T09:00:00.000Z");
    expect(snapshot?.component.retryCount).toBe(2);
    expect(snapshot?.worker.parityStatus).toBe("mismatch");
    expect(snapshot?.worker.parityReasons).toEqual([
      "worker_sha_mismatch:cb36fb16fa4c",
      "expected_commit_missing",
    ]);
    expect(snapshot?.worker.actionableParityReasons).toEqual([
      "worker_sha_mismatch:cb36fb16fa4c",
    ]);
    expect(snapshot?.worker.runtimeGenerationStatus).toBe("mismatch");
    expect(snapshot?.worker.runtimeGenerationReasons).toEqual([
      "runtime_runner_version_mismatch:cb36fb16fa4c",
    ]);
    expect(snapshot?.worker.actionableRuntimeGenerationReasons).toEqual([
      "runtime_runner_version_mismatch:cb36fb16fa4c",
    ]);
  });
});
