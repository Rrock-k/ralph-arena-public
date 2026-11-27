import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRunnerInitReadinessSummary,
  buildRunnerInitProjection,
  injectGithubTokenInRepoUrl,
} from "./runner-init-readiness";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/project-assets", () => ({
  getProjectAssetManifest: vi.fn(() => Promise.resolve({ assets: [{ id: "asset-1" }], hash: "assets-hash" })),
}));

vi.mock("@/lib/project-identity", () => ({
  getProjectDescription: vi.fn(() => "Fallback description"),
  getProjectName: vi.fn(() => "Fallback project"),
}));

import { prisma } from "@/lib/prisma";

describe("runner init readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  it("summarizes init readiness without exposing command template, repo token or secret values", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce(project({
      secrets: [{
        key: "PRIVATE_TOKEN",
        encryptedValue: "ciphertext",
        iv: "iv",
        authTag: "tag",
      }],
    }));

    const summary = await buildRunnerInitReadinessSummary("project-1");

    expect(summary).toMatchObject({
      schemaVersion: "ra-356.runner-init-readiness.v1",
      projectId: "project-1",
      available: true,
      specs: { count: 1 },
      assets: { count: 1, hash: "assets-hash" },
      secrets: { count: 1 },
      command: {
        present: true,
        source: "agent_loop_version",
        legacyPathNormalized: true,
        requiresLoopSource: true,
        loopSourcePresent: true,
        unresolvedPlaceholders: [],
        resolvable: true,
      },
      loopSource: {
        present: true,
        ref: "v1.4.0",
        installCommandPresent: true,
      },
      ralphConfig: {
        present: false,
        visualEvidenceMode: "off",
        visualWorkbenchExecutorCaptureShell: "not_configured",
      },
      blockers: [],
    });
    expect(JSON.stringify(summary)).not.toContain("node ");
    expect(JSON.stringify(summary)).not.toContain("ciphertext");
    expect(JSON.stringify(summary)).not.toContain("PRIVATE_TOKEN");
  });

  it("reports command blockers without adding fallback command semantics", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce(project({
      agentLoopVersion: null,
    }));

    const summary = await buildRunnerInitReadinessSummary("project-1");

    expect(summary).toMatchObject({
      available: true,
      command: {
        present: false,
        source: "missing",
        resolvable: false,
      },
      blockers: ["init_command_missing"],
    });
  });

  it("keeps token injection out of the projection and scoped to init route repo output", async () => {
    process.env.GITHUB_TOKEN = "gh-secret";
    const projection = await buildRunnerInitProjection(project());

    expect(projection.repo?.url).toBe("https://github.com/example/repo");
    const tokenizedUrl = injectGithubTokenInRepoUrl(projection.repo!.url);
    expect(tokenizedUrl).toContain("x-access-token:");
    expect(tokenizedUrl).toContain("gh-secret");
  });

  it("projects explicit Visual Workbench automation runtime config into runner-owned Ralph config", async () => {
    const projection = await buildRunnerInitProjection(project({
      components: [{
        kind: "app",
        agentIntent: "ON",
        lastOutcome: null,
        sourceConfig: {},
        runtimeConfig: {
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run visual-workbench"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      }],
    }));

    expect(projection.ralphConfig).toEqual({
      visualWorkbench: {
        visualEvidenceMode: "required",
        executorCaptureShell: {
          mode: "allowlisted",
          allowedServeCommands: ["npm run visual-workbench"],
          allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
        },
      },
    });
  });

  it("summarizes explicit new-tasks-only visual evidence readiness", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce(project({
      components: [{
        kind: "app",
        agentIntent: "ON",
        lastOutcome: null,
        sourceConfig: {},
        runtimeConfig: {
          visualEvidenceMode: "new_tasks_only",
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run visual-workbench"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      }],
    }));

    const summary = await buildRunnerInitReadinessSummary("project-1");

    expect(summary).toMatchObject({
      available: true,
      ralphConfig: {
        present: true,
        visualEvidenceMode: "new_tasks_only",
        visualWorkbenchExecutorCaptureShell: "allowlisted",
      },
    });
  });

  it("reports invalid Visual Workbench runtime config as read-side blocker", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce(project({
      components: [{
        kind: "app",
        agentIntent: "ON",
        lastOutcome: null,
        sourceConfig: {},
        runtimeConfig: {
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run dev"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      }],
    }));

    const summary = await buildRunnerInitReadinessSummary("project-1");

    expect(summary).toMatchObject({
      available: true,
      ralphConfig: {
        present: false,
        visualEvidenceMode: null,
        visualEvidenceModeError: expect.stringMatching(/first-party Workbench allowlist/),
      },
      blockers: ["visual_evidence_runtime_config_invalid"],
    });
    expect(summary.evidenceNotes).toEqual(expect.arrayContaining([
      expect.stringMatching(/Visual evidence runtimeConfig is invalid/),
    ]));
  });

  it("rejects explicit Visual Workbench runtime config that does not match the first-party allowlist", async () => {
    await expect(buildRunnerInitProjection(project({
      components: [{
        kind: "app",
        agentIntent: "ON",
        lastOutcome: null,
        sourceConfig: {},
        runtimeConfig: {
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run dev"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      }],
    }))).rejects.toThrow(/first-party Workbench allowlist/);
  });
});

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    repoUrl: "https://github.com/example/repo",
    repoBranch: "main",
    commitSha: null,
    agent: "codex",
    agentImpl: "ralph",
    model: "gpt-5.4",
    providerBillingMode: "byok",
    visibility: "public",
    proposal: { title: "Demo", description: "Demo description" },
    specs: [{
      id: "spec-1",
      title: "Spec",
      content: "Build",
      orderIndex: 0,
      updatedAt: new Date("2026-06-06T00:00:00.000Z"),
    }],
    secrets: [],
    components: [{
      kind: "app",
      agentIntent: "ON",
      lastOutcome: null,
      sourceConfig: {},
      runtimeConfig: {},
    }],
    agentLoopVersion: {
      version: "1.4.0",
      commandTemplate: "node /ralph/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent} --model {model}",
      capabilities: ["progress"],
      agentLoop: {
        sourceUrl: "https://github.com/example-owner/raleph.git",
        installCommand: "npm install && npm run build",
      },
    },
    ...overrides,
  };
}
