import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/control-plane", () => ({
  getWorkspaceRoot: vi.fn(() => "/tmp/project-workspaces"),
  getWorkspaceBackupRoot: vi.fn(() => "/tmp/runtime-backups"),
}));

import { existsSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { runProjectAudit } from "./project-audit";

function buildProjectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Ant Dream",
    archivedAt: null,
    agent: "codex",
    agentImpl: "ralph",
    agentLoopVersionId: "loop-version-1",
    agentLoopVersion: {
      id: "loop-version-1",
      commandTemplate: "npm test",
      supportTier: "supported",
      version: "1.5.0",
    },
    toolId: "tool-1",
    tool: {
      id: "tool-1",
      name: "codex",
    },
    runnerBackend: "local",
    proposal: { title: "Ant Dream" },
    specs: [{ id: "spec-1" }],
    budget: { isEnabled: true, totalCreditsUsd: 20 },
    runtimeIntents: [],
    components: [{
      kind: "app",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "FAILED",
      runtimeConfig: { useRepoHead: true },
      sourceConfig: {},
    }],
    ...overrides,
  };
}

describe("runProjectAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it("flags resident idle rows that lost runtime while still enabled", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true });
    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "state-machine/idle-agent-needs-runtime",
        severity: "error",
      }),
    ]));
  });

  it("flags running rows whose component lost runtime identity", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "OFF",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "COMPLETED",
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
          containerName: null,
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true });
    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "state-machine/running-runtime-needs-component-identity",
        severity: "error",
      }),
    ]));
  });

  it("flags agentIntent ON when power is OFF", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true });
    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "state-machine/agent-intent-needs-power",
        severity: "error",
      }),
    ]));
  });

  it("flags retryable blockers that lost retryAt truth", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: ["RATE_LIMIT"],
          retryAt: null,
          lastOutcome: null,
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true });
    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "state-machine/retryable-blocker-needs-retry-at",
        severity: "error",
      }),
    ]));
  });

  it("flags parked rows that still carry stale blocker and retry baggage", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: ["INFRA"],
          retryAt: new Date("2026-04-23T05:00:00.000Z"),
          retryCount: 2,
          lastOutcome: "COMPLETED",
          previewHealth: "UNKNOWN",
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true });
    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "state-machine/parked-row-has-blockers",
        severity: "warning",
      }),
      expect.objectContaining({
        rule: "state-machine/parked-row-has-retry-at",
        severity: "warning",
      }),
      expect.objectContaining({
        rule: "state-machine/parked-row-has-retry-count",
        severity: "warning",
      }),
    ]));
    expect(report.projects[0]?.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "state-machine/retryable-blocker-needs-retry-at",
      }),
    ]));
  });

  it("flags parked rows that still carry stale runtime identity and preview truth", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "OFF",
          agentIntent: "OFF",
          runtimeState: "ABSENT",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "FAILED",
          previewHealth: "HEALTHY",
          containerName: "preview-ant-dream",
          previewUrl: "https://preview-ant-dream.arena.example.test",
          workerHost: "local",
          lastHeartbeat: new Date("2026-04-23T02:00:00.000Z"),
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true });
    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "state-machine/parked-row-has-runtime-identity",
        severity: "warning",
      }),
      expect.objectContaining({
        rule: "state-machine/parked-row-preview-health-not-unknown",
        severity: "warning",
      }),
    ]));
  });

  it("flags legacy agent_project sourceConfig recipe format", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "COMPLETED",
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {
            recipe: "agent_project",
            agent: "codex",
            agentImpl: "ralph",
            repoBranch: "main",
          },
          containerName: "preview-ant-dream",
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true, includeMigrationChecks: true });

    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "migration/source-config-format",
        severity: "warning",
      }),
    ]));
  });

  it("does not flag live tg-spec sourceConfig recipes as legacy format", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: ["RATE_LIMIT"],
          retryAt: new Date("2026-04-23T10:00:00.000Z"),
          lastOutcome: null,
          previewHealth: "HEALTHY",
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {
            recipe: "tg_spec_target",
            agent: "claude-code",
            agentImpl: "ralph",
            repoBranch: "main",
          },
          containerName: "preview-sushi-kitties",
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit({ skipFilesystem: true, includeMigrationChecks: true });

    expect(report.projects[0]?.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "migration/source-config-format",
      }),
    ]));
  });

  it("suggests Recreate Runtime for loop-state migration on maintenance-safe resident runtimes", async () => {
    vi.mocked(existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("/project-1")
        || value.endsWith("/project-1/.arena/plan.json")
        || value.endsWith("/project-1/.arena/ralph-progress.json");
    });
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        slug: "project-1",
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: "COMPLETED",
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit();

    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "loop-state-migration",
        severity: "warning",
        message: "Ralph internal state in .arena/: plan.json, ralph-progress.json (use Recreate Runtime)",
      }),
    ]));
  });

  it("waits for a maintenance-safe window before recommending Recreate Runtime on active runs", async () => {
    vi.mocked(existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("/project-1")
        || value.endsWith("/project-1/.arena/plan.json");
    });
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        slug: "project-1",
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "RUNNING",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
          containerName: "preview-project-1",
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit();

    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "loop-state-migration",
        severity: "warning",
        message: "Ralph internal state in .arena/: plan.json (wait for a maintenance-safe window, then use Recreate Runtime)",
      }),
    ]));
  });

  it("keeps ordinary resident idle rows on the broader cleanup hint", async () => {
    vi.mocked(existsSync).mockImplementation((target: any) => {
      const value = String(target);
      return value.endsWith("/project-1")
        || value.endsWith("/project-1/.arena/plan.json");
    });
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      buildProjectRow({
        slug: "project-1",
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: [],
          lastOutcome: null,
          runtimeConfig: { useRepoHead: true },
          sourceConfig: {},
          containerName: "preview-project-1",
        }],
      }),
    ] as never[]);

    const report = await runProjectAudit();

    expect(report.projects[0]?.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "loop-state-migration",
        severity: "warning",
        message: "Ralph internal state in .arena/: plan.json (clean on the next explicit relaunch or runtime recreate)",
      }),
    ]));
  });
});
