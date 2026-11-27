import { describe, expect, it, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  projectFindMany: vi.fn(),
  runLogFindMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findMany: prismaMock.projectFindMany,
    },
    runLog: {
      findMany: prismaMock.runLogFindMany,
    },
  },
}));

vi.mock("@/lib/required-secrets", () => ({
  parseRequiredSecrets: vi.fn((value) => value),
}));

vi.mock("@/lib/project-access", () => ({
  resolveProjectAccessMap: vi.fn(async () => ({
    "project-1": { effectiveCapabilities: ["project.runtime.manage"] },
  })),
}));

vi.mock("@/lib/preview-url", () => ({
  getPreferredPreviewUrl: vi.fn(({ previewUrl }) => previewUrl ?? null),
}));

import { buildAdminOpsProjects, buildProjectOperatorSnapshot, getAdminOpsRawProjects } from "./admin-ops-projects";

describe("getAdminOpsRawProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads run logs through bounded per-project queries instead of the Prisma relation loader", async () => {
    const createdAt = new Date("2026-05-03T10:00:00.000Z");
    prismaMock.projectFindMany.mockResolvedValue([{ id: "project-1", name: "Project" }]);
    prismaMock.runLogFindMany.mockResolvedValue([{
      id: "log-1",
      projectId: "project-1",
      event: "RUNNING",
      detail: null,
      createdAt,
    }]);

    const projects = await getAdminOpsRawProjects(["project-1"]);

    const projectQuery = prismaMock.projectFindMany.mock.calls[0]?.[0];
    expect(projectQuery.select.runLogs).toBeUndefined();
    expect(projectQuery.select.components.select.sourceConfig).toBe(true);
    expect(prismaMock.runLogFindMany).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        projectId: true,
        event: true,
        detail: true,
        createdAt: true,
      },
    });
    expect(projects[0]?.runLogs).toEqual([{ id: "log-1", event: "RUNNING", detail: null, createdAt }]);
  });

});

describe("buildAdminOpsProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("projects visual evidence mode readback without hiding invalid runtime config", async () => {
    const legacyAutomation = {
      enabled: true,
      allowedServeCommands: ["npm run visual-workbench"],
      allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
    };
    const projects = await buildAdminOpsProjects([
      rawAdminOpsProject({
        id: "project-off",
        components: [rawAppComponent({ runtimeConfig: {} })],
      }),
      rawAdminOpsProject({
        id: "project-required",
        components: [rawAppComponent({
          runtimeConfig: {
            visualWorkbenchEvidenceAutomation: legacyAutomation,
          },
        })],
      }),
      rawAdminOpsProject({
        id: "project-invalid",
        components: [rawAppComponent({
          runtimeConfig: {
            visualEvidenceMode: "sometimes",
          },
        })],
      }),
      rawAdminOpsProject({
        id: "project-invalid-legacy",
        components: [rawAppComponent({
          runtimeConfig: {
            visualWorkbenchEvidenceAutomation: {
              enabled: true,
              allowedServeCommands: ["npm run dev"],
              allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
            },
          },
        })],
      }),
    ] as any, null, false);

    expect(projects[0]?.visualEvidenceMode).toBe("off");
    expect(projects[0]?.visualEvidenceModeError).toBeNull();
    expect(projects[1]?.visualEvidenceMode).toBe("required");
    expect(projects[1]?.visualEvidenceModeError).toBeNull();
    expect(projects[2]?.visualEvidenceMode).toBeNull();
    expect(projects[2]?.visualEvidenceModeError).toMatch(/expected off, required or new_tasks_only/);
    expect(projects[3]?.visualEvidenceMode).toBeNull();
    expect(projects[3]?.visualEvidenceModeError).toMatch(/first-party Workbench allowlist/);

    const invalidSnapshot = buildProjectOperatorSnapshot(projects[2]!);
    expect(invalidSnapshot.visualEvidenceMode).toBeNull();
    expect(invalidSnapshot.visualEvidenceModeError).toMatch(/expected off, required or new_tasks_only/);
  });

  it("keeps retryAt on the primary component instead of flattening it onto the project snapshot", async () => {
    const retryAt = new Date("2026-04-18T12:34:00.000Z");
    const projects = await buildAdminOpsProjects([{
      id: "project-1",
      name: "Ant Dream",
      slug: "ant-dream",
      mode: "proposal",
      ownerScopeType: "USER",
      ownerScopeId: "user-1",
      archivedAt: null,
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5",
      providerBillingMode: "platform_credits",
      runnerBackend: "local",
      isPinned: false,
      visibility: "PRIVATE",
      createdAt: new Date("2026-04-18T10:00:00.000Z"),
      updatedAt: new Date("2026-04-18T10:05:00.000Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      repoUrl: null,
      repoBranch: null,
      commitSha: null,
      claudeAuthMode: null,
      codexAuthMode: null,
      progressJson: null,
      requiredSecrets: [],
      proposal: null,
      agentLoopVersion: {
        version: "1.5.0",
        supportTier: "supported",
        agentLoop: { name: "ralph" },
      },
      secrets: [],
      budget: null,
      components: [{
        kind: "app",
        powerIntent: "ON",
        agentIntent: "ON",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: ["INFRA"],
        lastOutcome: "FAILED",
        retryAt,
        provisionedAt: new Date("2026-04-18T09:00:00.000Z"),
        containerName: null,
        previewUrl: null,
        workerHost: "local",
        runtimeConfig: { useRepoHead: true },
      }],
      vpsHost: null,
      runLogs: [],
      specs: [],
      assets: [],
    }] as any, null, false);

    expect(projects[0]?.components?.[0]?.retryAt).toEqual(retryAt);
    expect("retryAt" in (projects[0] ?? {})).toBe(false);
    expect(projects[0]?.useRepoHead).toBe(true);
    expect("startedAt" in (projects[0] ?? {})).toBe(false);
    expect("finishedAt" in (projects[0] ?? {})).toBe(false);
    expect("lastError" in (projects[0] ?? {})).toBe(false);
  });

  it("keeps runtime identity on the primary component instead of flattening it onto the project snapshot", async () => {
    const projects = await buildAdminOpsProjects([{
      id: "project-1",
      name: "Ant Dream",
      slug: "ant-dream",
      mode: "proposal",
      ownerScopeType: "USER",
      ownerScopeId: "user-1",
      archivedAt: null,
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5",
      providerBillingMode: "platform_credits",
      runnerBackend: "local",
      isPinned: false,
      visibility: "PRIVATE",
      createdAt: new Date("2026-04-18T10:00:00.000Z"),
      updatedAt: new Date("2026-04-18T10:05:00.000Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      repoUrl: null,
      repoBranch: null,
      commitSha: null,
      claudeAuthMode: null,
      codexAuthMode: null,
      progressJson: null,
      requiredSecrets: [],
      proposal: null,
      agentLoopVersion: {
        version: "1.5.0",
        supportTier: "supported",
        agentLoop: { name: "ralph" },
      },
      secrets: [],
      budget: null,
      components: [{
        kind: "app",
        powerIntent: "OFF",
        agentIntent: "OFF",
        runtimeState: "ABSENT",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        retryAt: null,
        provisionedAt: new Date("2026-04-18T09:00:00.000Z"),
        containerName: null,
        previewUrl: null,
        workerHost: null,
        runtimeConfig: {},
      }],
      vpsHost: null,
      runLogs: [],
      specs: [],
      assets: [],
    }] as any, null, false);

    expect(projects[0]?.components?.[0]?.containerName).toBeNull();
    expect(projects[0]?.components?.[0]?.workerHost).toBeNull();
    expect(projects[0]?.components?.[0]?.previewUrl).toBeNull();
    expect("containerName" in (projects[0] ?? {})).toBe(false);
    expect("workerHost" in (projects[0] ?? {})).toBe(false);
    expect("previewUrl" in (projects[0] ?? {})).toBe(false);
    expect("startedAt" in (projects[0] ?? {})).toBe(false);
    expect("finishedAt" in (projects[0] ?? {})).toBe(false);
    expect("lastError" in (projects[0] ?? {})).toBe(false);
  });

  it("builds a narrow operator snapshot instead of leaking admin ballast", async () => {
    const projects = await buildAdminOpsProjects([{
      id: "project-1",
      name: "Ant Dream",
      slug: "ant-dream",
      mode: "proposal",
      ownerScopeType: "USER",
      ownerScopeId: "user-1",
      archivedAt: null,
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5",
      providerBillingMode: "platform_credits",
      runnerBackend: "local",
      isPinned: false,
      visibility: "PRIVATE",
      createdAt: new Date("2026-04-18T10:00:00.000Z"),
      updatedAt: new Date("2026-04-18T10:05:00.000Z"),
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      repoUrl: "https://github.com/example/ant-dream",
      repoBranch: "arena/project-project-1",
      commitSha: "abc123",
      claudeAuthMode: null,
      codexAuthMode: null,
      progressJson: { state: "running" },
      requiredSecrets: [],
      proposal: { id: "proposal-1", title: "Proposal", description: "desc" },
      agentLoopVersion: {
        version: "1.5.0",
        supportTier: "supported",
        agentLoop: { name: "ralph" },
      },
      secrets: [{ id: "secret-1", key: "API_KEY", description: null, createdAt: new Date(), updatedAt: new Date() }],
      budget: { isEnabled: true, totalCreditsUsd: 50, usedCreditsUsd: 1 },
      components: [{
        kind: "app",
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        retryAt: null,
        retryCount: 2,
        provisionedAt: new Date("2026-04-18T09:00:00.000Z"),
        containerName: "preview-ant-dream",
        previewUrl: "https://preview.example.com",
        workerHost: "local",
        lastHeartbeat: new Date("2026-04-18T10:06:00.000Z"),
        sourceConfig: {
          recipe: "tg_spec_target",
          launchConfiguration: "tg_spec_launch_configuration_configured",
        },
        runtimeConfig: {
          useRepoHead: true,
          visualEvidenceMode: "new_tasks_only",
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run visual-workbench"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      }],
      vpsHost: null,
      runLogs: [{ id: "log-1", event: "RUNNING", detail: "ok", createdAt: new Date() }],
      specs: [{ id: "spec-1", title: "Spec", content: "content", orderIndex: 0 }],
      assets: [{ id: "asset-1", path: "foo.txt", originalName: "foo.txt", contentType: "text/plain", sizeBytes: 1, sha256: "hash", uploadedById: "user-1", createdAt: new Date(), updatedAt: new Date() }],
    }] as any, null, false);

    expect(projects[0]?.visualEvidenceMode).toBe("new_tasks_only");

    const snapshot = buildProjectOperatorSnapshot(projects[0]!);

    expect(snapshot).toEqual({
      id: "project-1",
      name: "Ant Dream",
      archivedAt: null,
      repoUrl: "https://github.com/example/ant-dream",
      repoBranch: "arena/project-project-1",
      providerBillingMode: "platform_credits",
      budget: { isEnabled: true },
      app: {
        powerIntent: "ON",
        agentIntent: "OFF",
        runtimeState: "RUNNING",
        agentState: "IDLE",
        blockers: [],
        lastOutcome: "COMPLETED",
        previewHealth: "HEALTHY",
        previewUrl: "https://preview.example.com",
        retryAt: null,
        retryCount: 2,
        provisionedAt: new Date("2026-04-18T09:00:00.000Z"),
        containerName: "preview-ant-dream",
        workerHost: "local",
        lastHeartbeat: new Date("2026-04-18T10:06:00.000Z"),
      },
      loopRuntime: "ralph Bundled default",
      loopSupportStatus: "supported",
      loopSupportLabel: "supported",
      loopSupportHint: "Bundled default is the only supported Ralph runtime right now.",
      visualEvidenceMode: "new_tasks_only",
      visualEvidenceModeError: null,
      appStartAllowed: true,
      agentStartAllowed: true,
      relaunchAllowed: true,
      tgSpecLaunchConfiguration: "tg_spec_launch_configuration_configured",
    });
    expect("proposal" in snapshot).toBe(false);
    expect("secrets" in snapshot).toBe(false);
    expect("runLogs" in snapshot).toBe(false);
    expect("specs" in snapshot).toBe(false);
    expect("assets" in snapshot).toBe(false);
    expect("accessCapabilities" in snapshot).toBe(false);
  });
});

function rawAdminOpsProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Ant Dream",
    slug: "ant-dream",
    mode: "proposal",
    ownerScopeType: "USER",
    ownerScopeId: "user-1",
    archivedAt: null,
    agent: "codex",
    agentImpl: "ralph",
    model: "gpt-5",
    providerBillingMode: "platform_credits",
    runnerBackend: "local",
    isPinned: false,
    visibility: "PRIVATE",
    createdAt: new Date("2026-04-18T10:00:00.000Z"),
    updatedAt: new Date("2026-04-18T10:05:00.000Z"),
    estimatedCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    repoUrl: null,
    repoBranch: null,
    commitSha: null,
    claudeAuthMode: null,
    codexAuthMode: null,
    progressJson: null,
    requiredSecrets: [],
    proposal: null,
    agentLoopVersion: {
      version: "1.5.0",
      supportTier: "supported",
      agentLoop: { name: "ralph" },
    },
    secrets: [],
    budget: null,
    components: [rawAppComponent()],
    vpsHost: null,
    runLogs: [],
    specs: [],
    assets: [],
    ...overrides,
  };
}

function rawAppComponent(overrides: Record<string, unknown> = {}) {
  return {
    kind: "app",
    powerIntent: "ON",
    agentIntent: "ON",
    runtimeState: "RUNNING",
    agentState: "IDLE",
    blockers: [],
    lastOutcome: null,
    previewHealth: null,
    retryAt: null,
    retryCount: 0,
    provisionedAt: null,
    containerName: null,
    previewUrl: null,
    workerHost: "local",
    lastHeartbeat: null,
    sourceConfig: {},
    runtimeConfig: {},
    ...overrides,
  };
}
