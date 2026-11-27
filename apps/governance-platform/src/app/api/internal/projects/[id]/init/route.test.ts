import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decryptSecret: vi.fn(),
  getEncryptionKey: vi.fn(),
}));

vi.mock("@/lib/project-identity", () => ({
  getProjectDescription: vi.fn(() => "Fallback description"),
  getProjectName: vi.fn(() => "Fallback project"),
}));

vi.mock("@/lib/project-assets", () => ({
  getProjectAssetManifest: vi.fn(() => Promise.resolve({ assets: [], hash: "assets-empty" })),
}));

import { prisma } from "@/lib/prisma";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { getEncryptionKey } from "@/lib/crypto";

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

describe("GET /api/internal/projects/:id/init", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(getEncryptionKey).mockReturnValue(Buffer.alloc(32));
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({
      id: "proj-1",
      state: "ACTIVE",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,

      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [],
      secrets: [],
      components: [
        {
          kind: "app",
          desiredRuntime: "RUNNING",
          actualRuntime: "ABSENT",
          implState: "IDLE",
          pauseReason: null,
          sourceConfig: {},
          runtimeConfig: {},
        },
      ],
      agentLoopVersion: {
        version: "1.4.0",
        commandTemplate:
          "node /ralph/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent} --model {model}",
        capabilities: ["progress", "specs"],
        agentLoop: {
          sourceUrl: "https://github.com/example-owner/raleph.git",
          installCommand: "npm install && npm run build",
        },
      },
    });
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(401);
    expect(isRunnerAuthorized).toHaveBeenCalledWith(expect.any(Request), { projectId: "proj-1" });
  });

  it("returns platformPrompt based on project visibility", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.platformPrompt).toContain("X-Ralph-Anon-Id");
    expect(body.platformPrompt).toContain("X-Arena-Project-Role");
    expect(body.platformPrompt).toContain("X-Arena-Project-Capabilities");
    expect(body.platformPrompt).toContain("owner|admin");
    expect(body.platformPrompt).toContain("Only authenticated platform users");
    expect(body.platformPrompt).not.toContain("Project-Owned Telegram Mini App");
    expect(body.platformPrompt).not.toContain("TELEGRAM_BOT_TOKEN");
    expect(body.platformPrompt).not.toContain("setChatMenuButton");
    expect(body.project).toMatchObject({
      id: "proj-1",
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      hasPendingLoopWork: true,
      agentIntent: "ON",
    });
    expect(body.ralphConfig).toBeNull();
  });

  it("returns runner-owned Ralph config only from explicit runtimeConfig automation enablement", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      state: "ACTIVE",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.4",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [],
      secrets: [],
      components: [{
        kind: "app",
        agentIntent: "ON",
        sourceConfig: {},
        runtimeConfig: {
          visualWorkbenchEvidenceAutomation: {
            enabled: true,
            allowedServeCommands: ["npm run visual-workbench"],
            allowedBaseUrlEnv: ["VISUAL_WORKBENCH_BASE_URL"],
          },
        },
      }],
      agentLoopVersion: {
        version: "1.4.0",
        commandTemplate:
          "node /ralph/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent} --model {model}",
        capabilities: ["progress", "specs"],
        agentLoop: {
          sourceUrl: "https://github.com/example-owner/raleph.git",
          installCommand: "npm install && npm run build",
        },
      },
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ralphConfig).toEqual({
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

  it("does not pin runner init to archived commit when loop work is pending", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      state: "ACTIVE",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: "stale-snapshot-sha",
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [],
      secrets: [],
      components: [{
        kind: "app",
        sourceConfig: {},
        runtimeConfig: {},
        lastOutcome: null,
      }],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project.hasPendingLoopWork).toBe(true);
    expect(body.project.commitSha).toBeNull();
  });

  it("keeps archived commit pin for retained previews with no pending loop work", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      state: "ACTIVE",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: "completed-snapshot-sha",
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [],
      secrets: [],
      components: [{
        kind: "app",
        sourceConfig: {},
        runtimeConfig: {},
        lastOutcome: "COMPLETED",
        lastOutcomeAt: "2026-06-01T00:00:00.000Z",
      }],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project.hasPendingLoopWork).toBe(false);
    expect(body.project.commitSha).toBe("completed-snapshot-sha");
  });

  it("returns featured visibility description for featured projects", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      state: "ACTIVE",
      repoUrl: "",
      repoBranch: "main",
      commitSha: null,

      agent: "claude-code",
      agentImpl: "direct",
      model: null,
      visibility: "featured",
      proposal: null,
      specs: [],
      secrets: [],
      components: [{
        desiredRuntime: "RUNNING",
        actualRuntime: "ABSENT",
        implState: "IDLE",
        pauseReason: null,
        sourceConfig: {},
        runtimeConfig: {},
      }],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(body.platformPrompt).toContain("Anyone can access");
  });

  it("normalizes legacy baked-in ralph paths to loopdir when loop source is present", async () => {
    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.commandTemplate).toBe(
      "node {loopdir}/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent} --model {model}",
    );
    expect(body.loopSource).toEqual({
      url: "https://github.com/example-owner/raleph.git",
      ref: "v1.4.0",
      installCommand: "npm install && npm run build",
    });
  });

  it("omits loopSource.ref when latest loop is requested", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      state: "ACTIVE",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,

      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [],
      secrets: [],
      components: [
        {
          kind: "app",
          desiredRuntime: "RUNNING",
          actualRuntime: "ABSENT",
          implState: "IDLE",
          pauseReason: null,
          sourceConfig: {},
          runtimeConfig: { useRepoHead: true },
        },
      ],
      agentLoopVersion: {
        version: "1.4.0",
        commandTemplate:
          "node /ralph/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent} --model {model}",
        capabilities: ["progress", "specs"],
        agentLoop: {
          sourceUrl: "https://github.com/example-owner/raleph.git",
          installCommand: "npm install && npm run build",
        },
      },
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.loopSource).toEqual({
      url: "https://github.com/example-owner/raleph.git",
      installCommand: "npm install && npm run build",
    });
  });

  it("keeps failed-history rows idle when there is no spec drift", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [
        {
          id: "spec-1",
          title: "Spec",
          content: "Build",
          orderIndex: 0,
          updatedAt: new Date("2026-04-17T10:00:00.000Z"),
        },
      ],
      secrets: [],
      components: [
        {
          kind: "app",
          lastOutcome: "FAILED",
          lastOutcomeAt: new Date("2026-04-17T12:00:00.000Z"),
          agentIntent: "ON",
          sourceConfig: {},
          runtimeConfig: {},
        },
      ],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project).toMatchObject({
      hasPendingLoopWork: false,
    });
  });

  it("re-opens failed-history rows when new spec work exists", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [
        {
          id: "spec-1",
          title: "Spec",
          content: "Build",
          orderIndex: 0,
          updatedAt: new Date("2026-04-17T13:00:00.000Z"),
        },
      ],
      secrets: [],
      components: [
        {
          kind: "app",
          lastOutcome: "FAILED",
          lastOutcomeAt: new Date("2026-04-17T12:00:00.000Z"),
          agentIntent: "ON",
          sourceConfig: {},
          runtimeConfig: {},
        },
      ],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project).toMatchObject({
      hasPendingLoopWork: true,
    });
  });

  it("re-opens failed-history rows when accepted artifact metadata changed after the outcome", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [
        {
          id: "spec-1",
          title: "Spec",
          content: "Build",
          orderIndex: 0,
          updatedAt: new Date("2026-04-17T10:00:00.000Z"),
          versions: [{
            updatedAt: new Date("2026-04-17T13:00:00.000Z"),
            acceptedArtifact: acceptedArtifact("requires_loop_work"),
          }],
        },
      ],
      secrets: [],
      components: [
        {
          kind: "app",
          lastOutcome: "FAILED",
          lastOutcomeAt: new Date("2026-04-17T12:00:00.000Z"),
          agentIntent: "ON",
          sourceConfig: {},
          runtimeConfig: {},
        },
      ],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project).toMatchObject({
      hasPendingLoopWork: true,
    });
  });

  it("does not re-open failed-history rows for fresh context-only accepted artifact metadata", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [
        {
          id: "spec-1",
          title: "Spec",
          content: "Build",
          orderIndex: 0,
          updatedAt: new Date("2026-04-17T10:00:00.000Z"),
          versions: [{
            updatedAt: new Date("2026-04-17T13:00:00.000Z"),
            acceptedArtifact: acceptedArtifact("context_only"),
          }],
        },
      ],
      secrets: [],
      components: [
        {
          kind: "app",
          lastOutcome: "FAILED",
          lastOutcomeAt: new Date("2026-04-17T12:00:00.000Z"),
          agentIntent: "ON",
          sourceConfig: {},
          runtimeConfig: {},
        },
      ],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project).toMatchObject({
      hasPendingLoopWork: false,
    });
  });

  it("does not let a newer context-only spec mask older pending loop work on startup", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      repoUrl: "https://github.com/example/repo",
      repoBranch: "main",
      commitSha: null,
      agent: "claude-code",
      agentImpl: "ralph",
      model: "sonnet",
      visibility: "public",
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [
        {
          id: "spec-work",
          title: "Work Spec",
          content: "Build",
          orderIndex: 0,
          updatedAt: new Date("2026-04-17T10:00:00.000Z"),
          versions: [{
            updatedAt: new Date("2026-04-17T13:00:00.000Z"),
            acceptedArtifact: acceptedArtifact("requires_loop_work"),
          }],
        },
        {
          id: "spec-context",
          title: "Context Spec",
          content: "Context",
          orderIndex: 1,
          updatedAt: new Date("2026-04-17T10:01:00.000Z"),
          versions: [{
            updatedAt: new Date("2026-04-17T14:00:00.000Z"),
            acceptedArtifact: acceptedArtifact("context_only"),
          }],
        },
      ],
      secrets: [],
      components: [
        {
          kind: "app",
          lastOutcome: "FAILED",
          lastOutcomeAt: new Date("2026-04-17T12:00:00.000Z"),
          agentIntent: "ON",
          sourceConfig: {},
          runtimeConfig: {},
        },
      ],
      agentLoopVersion: null,
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.project).toMatchObject({
      hasPendingLoopWork: true,
    });
  });

  it("leaves already-portable command templates unchanged", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValueOnce({
      id: "proj-1",
      state: "ACTIVE",
      repoUrl: "",
      repoBranch: "main",
      commitSha: null,

      agent: "claude-code",
      agentImpl: "ralph",
      model: null,
      proposal: { title: "Test Proposal", description: "Test Description" },
      specs: [],
      secrets: [],
      components: [
        {
          kind: "app",
          desiredRuntime: "RUNNING",
          actualRuntime: "ABSENT",
          implState: "IDLE",
          pauseReason: null,
          sourceConfig: {},
          runtimeConfig: {
            commandTemplate:
              "node {loopdir}/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent}",
          },
        },
      ],
      agentLoopVersion: {
        version: "1.4.0",
        commandTemplate: "node /ralph/dist/index.js run --work-dir {workdir}",
        capabilities: ["progress"],
        agentLoop: {
          sourceUrl: "https://github.com/example-owner/raleph.git",
          installCommand: "npm install",
        },
      },
    });

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/init"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.commandTemplate).toBe(
      "node {loopdir}/dist/index.js run --work-dir {workdir} --spec {specfile} --agent {agent}",
    );
  });
});
