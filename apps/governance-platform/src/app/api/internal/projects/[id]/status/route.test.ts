import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { update: vi.fn(), findUnique: vi.fn() },
    spec: { findMany: vi.fn() },
    projectBudget: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

vi.mock("@/lib/run-auth", () => ({
  buildRunAuthSnapshot: vi.fn(async () => ({ auth: { AUTH_MODE: "subscription" }, version: "authv_123" })),
  buildRunAuthSnapshotFresh: vi.fn(async () => ({ auth: { AUTH_MODE: "subscription" }, version: "authv_fresh" })),
  narrowRunAuthModesForAgent: vi.fn((agent: string, modes: { claudeAuthMode?: string | null; codexAuthMode?: string | null }) => modes),
  RuntimeAuthUnavailableError: class RuntimeAuthUnavailableError extends Error {
    statusCode = 503;
  },
}));

vi.mock("@/lib/project-state-effects", () => ({
  getPrimaryComponentRow: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { getPrimaryComponentRow, updateComponentMetadata } from "@/lib/project-state-effects";
import {
  buildRunAuthSnapshot,
  buildRunAuthSnapshotFresh,
  narrowRunAuthModesForAgent,
  RuntimeAuthUnavailableError,
} from "@/lib/run-auth";

function acceptedArtifact(workImpact: "requires_loop_work" | "context_only" | "no_loop_work") {
  return {
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: "SPEC-ARTIFACT-001",
    acceptedAt: "2026-05-22T15:08:07.069Z",
    source: {
      id: "SRC-001",
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-proj-1",
      sourceVersion: 27,
      sourceRefType: "accepted_spec",
      sourceId: "tg-spec-version-27",
    },
    acceptedSpec: {
      id: "SPEC-001",
      version: 27,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: "Product Spec",
        sections: [],
        requirements: [],
        extensionBlocks: [],
      },
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRefs: ["SRC-001"],
    },
    acceptedDiff: {
      id: "DIFF-001",
      baseSpecVersion: 26,
      targetSpecVersion: 27,
      summary: "Accepted update.",
      items: [{
        id: "DIFF-001-001",
        targetType: workImpact === "context_only" ? "assumption" : "feedback",
        targetId: workImpact === "context_only" ? "ASM-001" : "BUG-001",
        changeType: workImpact === "context_only" ? "created" : "reopened",
        workImpact,
        summary: "Accepted diff item.",
        sourceRefs: ["SRC-001"],
      }],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

describe("GET /api/internal/projects/:id/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(buildRunAuthSnapshot).mockResolvedValue({ auth: { AUTH_MODE: "subscription" }, version: "authv_123" });
    vi.mocked(buildRunAuthSnapshotFresh).mockResolvedValue({ auth: { AUTH_MODE: "subscription" }, version: "authv_fresh" });
    vi.mocked(narrowRunAuthModesForAgent).mockImplementation((agent: string, modes: { claudeAuthMode?: string | null; codexAuthMode?: string | null }) => modes);
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      archivedAt: null,
      agent: "codex",
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    });
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([]);
    vi.mocked(prisma.projectBudget.findUnique as any).mockResolvedValue(null);
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(401);
    expect(isRunnerAuthorized).toHaveBeenCalledWith(expect.any(Request), { projectId: "proj-1" });
  });

  it("uses blocker-driven pause reason without a separate paused agent state", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "STOPPED",
      agentState: "IDLE",
      blockers: ["SECRETS"],
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

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: true,
      reason: "paused_secrets",
      agentIntent: "ON",
    });
    expect(updateComponentMetadata).not.toHaveBeenCalled();
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
  });

  it("maps MANUAL blockers to paused manual stop reason", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["MANUAL"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      shouldStop: true,
      reason: "paused_manual",
      agentIntent: "ON",
    });
  });

  it("maps BUDGET blockers to budget_exhausted stop reason", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["BUDGET"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "UNKNOWN",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: true,
      reason: "budget_exhausted",
      agentIntent: "ON",
    });
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
  });

  it("ignores legacy stop flags when primary component state is healthy", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      auth: { AUTH_MODE: "subscription" },
      authVersion: "authv_123",
    });
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "proj-1",
      { lastHeartbeat: expect.any(Date) },
      { source: "runner", trigger: "heartbeat" },
    );
    expect(prisma.spec.findMany).not.toHaveBeenCalled();
  });

  it("keeps failed preview-serving rows alive instead of forcing status_failed shutdown", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "FAILED",
      blockers: [],
      lastOutcome: "FAILED",
      lastOutcomeAt: new Date("2026-04-17T12:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-17T12:00:00.000Z"),
      provisionedAt: new Date("2026-04-17T10:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      auth: { AUTH_MODE: "subscription" },
      authVersion: "authv_123",
    });
  });

  it("stops runners with stale runtime identity", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
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
      workerHost: null,
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: true,
      reason: "stale_runtime_identity",
      agentIntent: "ON",
    });
    expect(updateComponentMetadata).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
  });

  it("keeps resident agent-off previews fresh while idle supervision is active", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "OFF",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: true,
      reason: "agent_off",
      agentIntent: "OFF",
    });
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "proj-1",
      { lastHeartbeat: expect.any(Date) },
      { source: "runner", trigger: "heartbeat" },
    );
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
  });

  it("keeps resident rate-limited previews fresh while waiting in idle supervision", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: new Date("2026-04-23T05:00:00.000Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-23T01:11:30.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-04-23T01:11:30.000Z"),
      retryCount: 3,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: true,
      reason: "status_paused_rate_limit",
      agentIntent: "ON",
    });
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      prisma,
      "proj-1",
      { lastHeartbeat: expect.any(Date) },
      { source: "runner", trigger: "heartbeat" },
    );
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
  });

  it("does not keep a blocker-free idle row artificially stopped", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 2,
      archivedAt: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      pendingLoopWork: true,
      auth: { AUTH_MODE: "subscription" },
      authVersion: "authv_123",
    });
    expect(prisma.spec.findMany).toHaveBeenCalledWith({
      where: { projectId: "proj-1" },
      orderBy: { orderIndex: "asc" },
      select: {
        updatedAt: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { updatedAt: true, acceptedArtifact: true },
        },
      },
    });
  });

  it("reports pending loop work for completed idle previews after spec drift", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-04-21T10:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-21T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-04-21T10:05:00.000Z"),
      versions: [],
    }]);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      pendingLoopWork: true,
      auth: { AUTH_MODE: "subscription" },
      authVersion: "authv_123",
    });
  });

  it("reports pending loop work for completed idle previews after accepted artifact metadata drift", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-05-20T02:47:54.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-05-20T02:47:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-05-20T02:40:00.000Z"),
      versions: [{
        updatedAt: new Date("2026-05-22T15:08:46.000Z"),
        acceptedArtifact: acceptedArtifact("requires_loop_work"),
      }],
    }]);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      pendingLoopWork: true,
    });
  });

  it("does not let a newer context-only spec mask older pending loop work", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-05-20T02:47:54.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-05-20T02:47:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([
      {
        updatedAt: new Date("2026-05-20T02:40:00.000Z"),
        versions: [{
          updatedAt: new Date("2026-05-21T12:00:00.000Z"),
          acceptedArtifact: acceptedArtifact("requires_loop_work"),
        }],
      },
      {
        updatedAt: new Date("2026-05-20T02:41:00.000Z"),
        versions: [{
          updatedAt: new Date("2026-05-22T12:00:00.000Z"),
          acceptedArtifact: acceptedArtifact("context_only"),
        }],
      },
    ]);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      pendingLoopWork: true,
    });
  });

  it("does not report pending loop work for completed idle previews after context-only accepted diff", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-05-20T02:47:54.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-05-20T02:47:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-05-20T02:40:00.000Z"),
      versions: [{
        updatedAt: new Date("2026-05-22T15:08:46.000Z"),
        acceptedArtifact: acceptedArtifact("context_only"),
      }],
    }]);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
    });
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
  });

  it("reports pending loop work when an idle resident runner corrects stale RUNNING state", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "RUNNING",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-04-21T10:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: new Date("2026-04-21T09:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-04-21T10:05:00.000Z"),
      versions: [],
    }]);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      pendingLoopWork: true,
      auth: { AUTH_MODE: "subscription" },
      authVersion: "authv_123",
    });
  });

  it("can force fresh auth mint for runner recovery", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?refreshAuth=1"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      auth: { AUTH_MODE: "subscription" },
      authVersion: "authv_fresh",
    });
  });

  it("returns 503 when refreshed runtime auth is unavailable", async () => {
    vi.mocked(buildRunAuthSnapshotFresh).mockRejectedValue(
      new RuntimeAuthUnavailableError("authd is unavailable"),
    );

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?refreshAuth=1"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "authd is unavailable" });
  });

  it("keeps status truth available when non-refresh runtime auth is unavailable", async () => {
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(buildRunAuthSnapshot).mockRejectedValue(
      new RuntimeAuthUnavailableError("authd is unavailable"),
    );

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      pendingLoopWork: true,
    });
  });

  it("does not attempt non-refresh auth mint for parked waiting rows", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["RATE_LIMIT"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: new Date("2026-04-23T05:00:00.000Z"),
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-23T01:11:30.000Z"),
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-04-23T01:11:30.000Z"),
      retryCount: 3,
      archivedAt: null,
    });
    vi.mocked(buildRunAuthSnapshot).mockRejectedValue(
      new RuntimeAuthUnavailableError("authd is unavailable"),
    );

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: true,
      reason: "status_paused_rate_limit",
      agentIntent: "ON",
    });
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("auth snapshot unavailable"));
    warnSpy.mockRestore();
  });

  it("does not attempt non-refresh auth mint for retained completed idle previews", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getPrimaryComponentRow as any).mockResolvedValue({
      projectId: "proj-1",
      componentId: "cmp-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: [],
      lastOutcome: "COMPLETED",
      lastOutcomeAt: new Date("2026-04-23T18:00:00.000Z"),
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: new Date("2026-04-23T18:00:00.000Z"),
      provisionedAt: new Date("2026-04-23T17:00:00.000Z"),
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: new Date("2026-04-23T18:10:00.000Z"),
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(buildRunAuthSnapshot).mockRejectedValue(
      new RuntimeAuthUnavailableError("authd is unavailable"),
    );

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?state=idle"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
    });
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("auth snapshot unavailable"));
    warnSpy.mockRestore();
  });

  it("narrows runtime auth polling to the active agent provider", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      archivedAt: null,
      lastError: null,
      agent: "codex",
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    });
    vi.mocked(narrowRunAuthModesForAgent).mockReturnValue({
      claudeAuthMode: "api_key",
      codexAuthMode: "subscription",
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(narrowRunAuthModesForAgent).toHaveBeenCalledWith("codex", {
      claudeAuthMode: "oauth",
      codexAuthMode: "subscription",
    });
    expect(buildRunAuthSnapshot).toHaveBeenCalledWith(
      {
        claudeAuthMode: "api_key",
        codexAuthMode: "subscription",
      },
      {
        agent: "codex",
        userId: null,
      },
    );
  });

  it("returns proxy-only auth for Platform Credits status refreshes", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "proj-1",
      archivedAt: null,
      lastError: null,
      agent: "codex",
      claudeAuthMode: null,
      codexAuthMode: "api_key",
      providerBillingMode: "platform_credits",
      runnerBackend: "local",
    });
    vi.mocked(prisma.projectBudget.findUnique as any).mockResolvedValue({
      isEnabled: true,
      totalCreditsUsd: 10,
      usedCreditsUsd: 1,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status?refreshAuth=1"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.auth).toEqual(expect.objectContaining({
      OPENAI_API_KEY: "arena-proxy",
      OPENAI_BASE_URL: "http://api-proxy:4100/openai/project/proj-1",
    }));
    expect(buildRunAuthSnapshotFresh).not.toHaveBeenCalled();
  });

  it("stops Platform Credits runners when required budget is missing", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "proj-1",
      archivedAt: null,
      lastError: null,
      agent: "codex",
      claudeAuthMode: null,
      codexAuthMode: null,
      providerBillingMode: "platform_credits",
      runnerBackend: "local",
    });
    vi.mocked(prisma.projectBudget.findUnique as any).mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({
      shouldStop: true,
      reason: "budget_exhausted",
    }));
    expect(buildRunAuthSnapshot).not.toHaveBeenCalled();
  });

  it("does not stop Platform Credentials runners because of legacy exhausted budgets", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "proj-1",
      archivedAt: null,
      lastError: null,
      agent: "codex",
      claudeAuthMode: null,
      codexAuthMode: "subscription",
      providerBillingMode: "platform_credentials",
      runnerBackend: "local",
    });
    vi.mocked(prisma.projectBudget.findUnique as any).mockResolvedValue({
      isEnabled: true,
      totalCreditsUsd: 10,
      usedCreditsUsd: 10,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/status"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      shouldStop: false,
      agentIntent: "ON",
      auth: { AUTH_MODE: "subscription" },
      authVersion: "authv_123",
    });
    expect(prisma.projectBudget.findUnique).not.toHaveBeenCalled();
  });

});
