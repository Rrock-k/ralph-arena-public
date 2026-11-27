import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildRuntimeIntentClaimDryRun } from "./runtime-intent-claim-dry-run";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/project-identity", () => ({
  buildProjectWorkspaceLabel: vi.fn(() => "mini-jam-abc123"),
}));

vi.mock("@/lib/run-auth", () => ({
  buildRunAuthEnvFresh: vi.fn(),
  narrowRunAuthModesForAgent: vi.fn(() => ({
    claudeAuthMode: "oauth",
    codexAuthMode: "chatgpt",
  })),
  resolveRunAuthModesForBuild: vi.fn((modes) => modes),
  RuntimeAuthUnavailableError: class RuntimeAuthUnavailableError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { prisma } from "@/lib/prisma";
import { buildRunAuthEnvFresh } from "@/lib/run-auth";

describe("buildRuntimeIntentClaimDryRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports no candidate without preparing launch state", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValueOnce([]);

    const result = await buildRuntimeIntentClaimDryRun({
      projectId: "project-1",
      host: "local",
      now: new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      schemaVersion: "ra-356.runtime-claim-dry-run.v1",
      projectId: "project-1",
      host: "local",
      backend: "local",
      wouldCreateLease: false,
      wouldClaim: null,
      blockingReasons: ["not_in_runtime_intent_claim_candidate_set"],
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("returns an agent-run projection with sanitized launch facts only", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValueOnce([candidate()]);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce(project());

    const result = await buildRuntimeIntentClaimDryRun({
      projectId: "project-1",
      host: "local",
      capacity: 1,
      now: new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(buildRunAuthEnvFresh).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      projectId: "project-1",
      policyDecision: {
        action: "ensure_running",
        runnerMode: "agent_run",
        attempt: 1,
      },
      policyRejectionReasons: [],
      wouldCreateLease: true,
      wouldClaim: {
        action: "ensure_running",
        runnerMode: "agent_run",
        workspaceLabel: "mini-jam-abc123",
        workerImage: "arena-worker:test",
        resources: { memoryMb: 2048, cpuCount: 1.5 },
      },
      launch: {
        required: true,
        status: "ready",
        sanitized: true,
        payload: {
          envSummary: {
            exposesValues: false,
            projectSecretCount: 1,
            auth: "not_checked",
          },
        },
      },
      blockingReasons: [],
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN");
  });

  it("reports policy rejection reasons for visible but exhausted candidates", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValueOnce([candidate({
      blockers: ["MANUAL", "INFRA"],
      lastAction: "ensure_running",
      lastState: "FAILED",
      lastAttempt: 5,
    })]);

    const result = await buildRuntimeIntentClaimDryRun({
      projectId: "project-1",
      host: "local",
      capacity: 1,
      now: new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      projectId: "project-1",
      candidate: {
        tuple: {
          blockers: ["MANUAL", "INFRA"],
        },
        lastIntent: {
          action: "ensure_running",
          state: "FAILED",
          attempt: 5,
        },
      },
      policyDecision: null,
      policyRejectionReasons: ["start_retry_capacity_exhausted"],
      wouldCreateLease: false,
      wouldClaim: null,
      blockingReasons: ["candidate_rejected_by_runtime_intent_policy"],
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });

  it("reports unsupported agent runtime candidates without preparing launch state", async () => {
    vi.mocked(prisma.$queryRawUnsafe as any).mockResolvedValueOnce([candidate({
      agentImpl: "ralph",
      loopName: "ralph",
      loopVersion: "0.9.0",
      loopSupportTier: "supported",
      runtimeConfig: {},
    })]);

    const result = await buildRuntimeIntentClaimDryRun({
      projectId: "project-1",
      host: "local",
      capacity: 1,
      now: new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      projectId: "project-1",
      candidate: {
        loopSupport: {
          status: "upgrade-required",
          agentStartAllowed: false,
        },
      },
      policyDecision: null,
      policyRejectionReasons: ["agent_runtime_unsupported"],
      wouldCreateLease: false,
      wouldClaim: null,
      blockingReasons: ["candidate_rejected_by_runtime_intent_policy"],
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    projectName: "Mini Jam",
    projectSlug: "mini-jam",
    proposalId: null,
    proposalTitle: null,
    componentId: "component-1",
    powerIntent: "ON",
    agentIntent: "ON",
    runtimeState: "ABSENT",
    agentState: "IDLE",
    runtimeMissingFromWorker: false,
    provisionedAt: new Date("2026-06-01T00:00:00.000Z"),
    pendingLoopWork: true,
    allowPreviewOnlyRestore: false,
    blockers: [],
    workerHost: "local",
    containerName: "preview-mini-jam-abc123",
    sourceConfig: null,
    tgSpecLastImportedVersion: 1,
    lastAction: null,
    lastState: null,
    lastAttempt: null,
    ...overrides,
  };
}

function project() {
  return {
    id: "project-1",
    name: "Mini Jam",
    slug: "mini-jam",
    proposalId: null,
    proposal: { title: null },
    ownerScopeType: "user",
    ownerScopeId: "user-1",
    providerBillingMode: "byok",
    cycleImage: "arena-public-worker:local",
    envOverrides: JSON.stringify({ CI: "custom" }),
    agent: "codex",
    agentImpl: "ralph",
    model: "gpt-5.4",
    claudeAuthMode: null,
    codexAuthMode: "chatgpt",
    budget: null,
    secrets: [{
      key: "PRIVATE_TOKEN",
      encryptedValue: "secret-value",
      iv: "iv",
      authTag: "tag",
    }],
    components: [{
      kind: "app",
      agentIntent: "ON",
      runtimeConfig: {
        cycleImage: "arena-worker:test",
        memoryMb: 2048,
        cpuCount: 1.5,
      },
    }],
  };
}
