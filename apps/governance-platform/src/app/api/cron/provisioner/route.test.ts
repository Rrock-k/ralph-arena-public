import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    project: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    projectComponent: { findFirst: vi.fn(), update: vi.fn() },
    projectBudget: { findUnique: vi.fn() },
    runLog: { create: vi.fn() },
    vpsHost: { create: vi.fn(), delete: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
  notifyProjectEvent: vi.fn(),
}));

vi.mock("@/lib/log-writer", () => ({
  appendLifecycle: vi.fn(),
}));

vi.mock("@/lib/internal-auth", () => ({
  isCronAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  requirePrimaryComponentRow: vi.fn(),
  applyStateChange: vi.fn(),
  updateComponentMetadata: vi.fn(),
}));

vi.mock("@/lib/vps/hetzner", () => ({
  provisionVps: vi.fn(),
  createDnsRecords: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { notifyProjectChanged, notifyProjectEvent } from "@/lib/progress-bus";
import { appendLifecycle } from "@/lib/log-writer";
import { isCronAuthorized } from "@/lib/internal-auth";
import {
  requirePrimaryComponentRow,
  applyStateChange,
  updateComponentMetadata,
} from "@/lib/project-state-effects";
import { provisionVps } from "@/lib/vps/hetzner";
import {
  VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
  parseVisualWorkbenchManifest,
} from "@arena/contracts";

describe("POST /api/cron/provisioner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.HETZNER_API_TOKEN;
    delete process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_OWNER;
    delete process.env.GITHUB_REPO_PREFIX;
    vi.mocked(isCronAuthorized).mockReturnValue(true);
    vi.mocked(prisma.$transaction as any).mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma as any),
    );
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "local",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);
    vi.mocked(prisma.project.updateMany as any).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.projectComponent.findFirst as any).mockResolvedValue({
      id: "cmp-1",
    });
    vi.mocked(prisma.projectComponent.update as any).mockResolvedValue({});
    vi.mocked(prisma.project.update as any).mockResolvedValue({});
    vi.mocked(prisma.runLog.create as any).mockResolvedValue({});
    vi.mocked((prisma as any).vpsHost.update).mockResolvedValue({});
    vi.mocked((prisma as any).vpsHost.upsert).mockResolvedValue({});
    vi.mocked(appendLifecycle as any).mockResolvedValue(undefined);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      retryCount: 0,
    });
    vi.mocked(applyStateChange as any).mockResolvedValue({});
    vi.mocked(updateComponentMetadata as any).mockResolvedValue({});
  });

  it("marks provisioning rows as provisioned and queues them for runtime claim", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
    expect(appendLifecycle).toHaveBeenCalledWith("proj-1", "QUEUED");
    expect(prisma.runLog.create).toHaveBeenCalledWith({
      data: {
        projectId: "proj-1",
        event: "QUEUED",
        detail: JSON.stringify({
          from: "PROVISIONING",
          trigger: "provisioner",
        }),
      },
    });
    expect(notifyProjectEvent).toHaveBeenCalledWith("proj-1", {
      type: "project_progress",
      status: "QUEUED",
    });
  });

  it("parks provisioning failures as recoverable INFRA pause without powering the project off", async () => {
    process.env.HETZNER_API_TOKEN = "token";
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "vps",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);
    vi.mocked((prisma as any).vpsHost.create).mockResolvedValue({
      id: "host-1",
    });
    vi.mocked(provisionVps as any).mockRejectedValue(
      new Error("Hetzner API unavailable"),
    );
    vi.mocked((prisma as any).vpsHost.delete).mockResolvedValue({});
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      retryCount: 2,
    });

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 0, pausedInfra: 1 });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({
        source: "cron",
        trigger: "provisioner",
        reason: "provisioning_failed",
      }),
    );
    expect(updateComponentMetadata).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      expect.objectContaining({
        retryCount: 3,
        retryAt: expect.any(Date),
      }),
      expect.objectContaining({
        source: "cron",
        trigger: "provisioner",
        reason: "provisioning_failed",
      }),
    );
    expect(notifyProjectChanged).toHaveBeenCalledWith("proj-1");
  });

  it("keeps a newly provisioned VPS unqueued until a later worker readiness tick", async () => {
    process.env.HETZNER_API_TOKEN = "token";
    process.env.SECRETS_ENCRYPTION_KEY = "00".repeat(32);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        name: "Example",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "vps",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);
    vi.mocked((prisma as any).vpsHost.create).mockResolvedValue({
      id: "host-1",
    });
    vi.mocked(provisionVps as any).mockResolvedValue({
      serverId: "srv-1",
      ip: "203.0.113.10",
      sshKeyId: "key-1",
      sshKey: {
        privateKey: "private-key",
        publicKey: "ssh-ed25519 public-key",
      },
    });

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      provisioned: 0,
      pausedInfra: 0,
    });
    expect((prisma as any).vpsHost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          ip: "203.0.113.10",
          status: "PROVISIONING",
          errorMessage: null,
        }),
      }),
    );
    expect(appendLifecycle).toHaveBeenCalledWith("proj-1", "VPS_PROVISIONED");
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
    expect(appendLifecycle).not.toHaveBeenCalledWith("proj-1", "QUEUED");
    expect(prisma.runLog.create).not.toHaveBeenCalled();
  });

  it("does not queue a VPS project until the worker health endpoint is ready", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "vps",
        vpsHost: {
          id: "host-1",
          ip: "203.0.113.10",
          status: "READY",
          createdAt: new Date(),
        },
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      provisioned: 0,
      pausedInfra: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://203.0.113.10:4200/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect((prisma as any).vpsHost.update).toHaveBeenCalledWith({
      where: { id: "host-1" },
      data: {
        status: "PROVISIONING",
        errorMessage: "connect ECONNREFUSED",
      },
    });
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
    expect(appendLifecycle).not.toHaveBeenCalledWith("proj-1", "QUEUED");
    expect(prisma.runLog.create).not.toHaveBeenCalled();
  });

  it("queues a VPS project only after the worker health endpoint is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          ok: true,
          host: "vps-proj",
          governanceReachable: true,
          runtimeIntentClaim: { lastSuccessAt: "2026-05-07T00:00:00.000Z" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "vps",
        vpsHost: {
          id: "host-1",
          ip: "203.0.113.10",
          status: "PROVISIONING",
          createdAt: new Date(),
        },
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    expect((prisma as any).vpsHost.update).toHaveBeenCalledWith({
      where: { id: "host-1" },
      data: {
        status: "READY",
        errorMessage: null,
      },
    });
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
    expect(appendLifecycle).toHaveBeenCalledWith("proj-1", "QUEUED");
  });

  it("does not queue a VPS project when worker is alive but cannot claim from governance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({
          ok: true,
          host: "vps-proj",
          governanceReachable: false,
          runtimeIntentClaim: { lastError: "HTTP 401" },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "vps",
        vpsHost: {
          id: "host-1",
          ip: "203.0.113.10",
          status: "PROVISIONING",
          createdAt: new Date(),
        },
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      provisioned: 0,
      pausedInfra: 0,
    });
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
    expect(appendLifecycle).not.toHaveBeenCalledWith("proj-1", "QUEUED");
  });

  it("keeps legacy worker health compatible for already-ready VPS hosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, host: "legacy-vps" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "vps",
        vpsHost: {
          id: "host-1",
          ip: "203.0.113.10",
          status: "READY",
          createdAt: new Date(),
        },
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
  });

  it("parks a VPS project as INFRA when worker readiness times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/repo",
        runnerBackend: "vps",
        vpsHost: {
          id: "host-1",
          ip: "203.0.113.10",
          status: "PROVISIONING",
          createdAt: new Date(Date.now() - 16 * 60_000),
        },
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: null,
          },
        ],
        proposal: null,
      },
    ]);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      retryCount: 0,
    });

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      provisioned: 0,
      pausedInfra: 1,
    });
    expect((prisma as any).vpsHost.update).toHaveBeenCalledWith({
      where: { id: "host-1" },
      data: {
        status: "ERROR",
        errorMessage: "Worker readiness timeout: timeout",
      },
    });
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({
        source: "cron",
        trigger: "provisioner",
        reason: "provisioning_failed",
      }),
    );
  });

  it("keeps tg-spec targets dormant before the first imported spec", async () => {
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: null,
        runnerBackend: "local",
        vpsHost: null,
        tgSpecLastImportedVersion: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "managed",
            runtimeConfig: {},
            sourceConfig: { recipe: "tg_spec_target" },
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      provisioned: 0,
      pausedInfra: 0,
    });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
    expect(appendLifecycle).not.toHaveBeenCalled();
  });

  it("seeds fresh managed agent-project repos on the runner project branch before queueing", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    process.env.GITHUB_REPO_PREFIX = "arena";
    const fetchMock = mockGitHubProvisionerFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        name: "Synth Jam",
        repoUrl: null,
        runnerBackend: "local",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "managed",
            runtimeConfig: {},
            sourceConfig: { recipe: "agent_project" },
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      data: {
        repoUrl: "https://github.com/example-owner/arena-synth-jam",
        repoBranch: "arena/project-proj-1",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/example-owner/arena-synth-jam/git/refs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ref: "refs/heads/arena/project-proj-1",
          sha: "base-sha",
        }),
      }),
    );
    for (const path of ["arena-start.sh", "package.json", "server.mjs"]) {
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.github.com/repos/example-owner/arena-synth-jam/contents/${path}`,
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"branch":"arena/project-proj-1"'),
        }),
      );
    }
    const seededPackage = JSON.parse(readSeededGithubContent(fetchMock, "package.json"));
    expect(seededPackage.scripts).toMatchObject({
      start: "node server.mjs",
    });
    expect(seededPackage.scripts).not.toHaveProperty("visual-workbench");
    const seededServer = readSeededGithubContent(fetchMock, "server.mjs");
    expect(seededServer).not.toContain("VISUAL_WORKBENCH_BASE_URL");
    expect(seededServer).not.toContain("/__visual/");
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes("/contents/visual-workbench/")
    )).toBe(false);

    const lastSeedCallOrder = Math.max(
      ...fetchMock.mock.calls
        .map((_, index) => ({
          index,
          order: fetchMock.mock.invocationCallOrder[index],
        }))
        .filter(({ index }) =>
          String(fetchMock.mock.calls[index]?.[0]).includes("/contents/"),
        )
        .map(({ order }) => order),
    );
    expect(
      vi.mocked(prisma.project.update as any).mock.invocationCallOrder[0],
    ).toBeGreaterThan(lastSeedCallOrder);
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
  });

  it("seeds explicit visual-workbench canary profile before queueing", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    process.env.GITHUB_REPO_PREFIX = "arena";
    const fetchMock = mockGitHubProvisionerFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        name: "Synth Jam",
        repoUrl: null,
        runnerBackend: "local",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "managed",
            runtimeConfig: {},
            sourceConfig: {
              recipe: "agent_project",
              sourceSeedProfile: "visual_workbench_canary_v0",
            },
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    for (const path of [
      "arena-start.sh",
      "package.json",
      "server.mjs",
      "visual-workbench/manifest.json",
      "visual-workbench/README.md",
      "visual-workbench/stories/managed-starter.ready.md",
    ]) {
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.github.com/repos/example-owner/arena-synth-jam/contents/${path}`,
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"branch":"arena/project-proj-1"'),
        }),
      );
    }

    const seededPackage = JSON.parse(readSeededGithubContent(fetchMock, "package.json"));
    expect(seededPackage.scripts).toMatchObject({
      start: "node server.mjs",
      "visual-workbench": "node server.mjs",
    });
    const seededServer = readSeededGithubContent(fetchMock, "server.mjs");
    expect(seededServer).toContain("VISUAL_WORKBENCH_BASE_URL");
    expect(seededServer).toContain("visualWorkbenchStoryPath");
    expect(seededServer).toContain("managed-starter.ready");

    const seededManifest = parseVisualWorkbenchManifest(
      JSON.parse(readSeededGithubContent(fetchMock, "visual-workbench/manifest.json")),
    );
    expect(seededManifest.schemaVersion).toBe(VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION);
    expect(seededManifest.projectClass).toBe("ordinary_web");
    expect(seededManifest.workbench.serveCommand).toBe("npm run visual-workbench");
    expect(seededManifest.workbench.baseUrlEnv).toBe("VISUAL_WORKBENCH_BASE_URL");
    expect(seededManifest.coveragePolicy.selectionDefault).toBe("full_manifest");
    expect(seededManifest.stories).toEqual([
      expect.objectContaining({
        id: "managed-starter.ready",
        feature: "managed-starter",
        widget: "StarterPage",
        state: "ready",
        render: {
          type: "workbench_route",
          path: "/__visual/managed-starter.ready",
        },
      }),
    ]);
    const seededWorkbenchReadme = readSeededGithubContent(fetchMock, "visual-workbench/README.md");
    expect(seededWorkbenchReadme).toContain("not proof");
    expect(seededWorkbenchReadme).toContain("task completion");

    const lastSeedCallOrder = Math.max(
      ...fetchMock.mock.calls
        .map((_, index) => ({
          index,
          order: fetchMock.mock.invocationCallOrder[index],
        }))
        .filter(({ index }) =>
          String(fetchMock.mock.calls[index]?.[0]).includes("/contents/"),
        )
        .map(({ order }) => order),
    );
    expect(
      vi.mocked(prisma.project.update as any).mock.invocationCallOrder[0],
    ).toBeGreaterThan(lastSeedCallOrder);
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
  });

  it("seeds explicit visual-workbench canary profile for tg-spec targets", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    process.env.GITHUB_REPO_PREFIX = "arena";
    const fetchMock = mockGitHubProvisionerFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-tg-1",
        name: "Accepted Synth Jam",
        repoUrl: null,
        runnerBackend: "local",
        tgSpecLastImportedVersion: 1,
        vpsHost: null,
        components: [
          {
            id: "cmp-tg-1",
            kind: "app",
            sourceType: "managed",
            runtimeConfig: {},
            sourceConfig: {
              recipe: "tg_spec_target",
              sourceSeedProfile: "visual_workbench_canary_v0",
            },
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    for (const path of [
      "arena-start.sh",
      "package.json",
      "server.mjs",
      "visual-workbench/manifest.json",
      "visual-workbench/stories/managed-starter.ready.md",
    ]) {
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.github.com/repos/example-owner/arena-synth-jam/contents/${path}`,
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"branch":"arena/project-proj-tg-1"'),
        }),
      );
    }

    const seededManifest = parseVisualWorkbenchManifest(
      JSON.parse(readSeededGithubContent(fetchMock, "visual-workbench/manifest.json")),
    );
    expect(seededManifest.projectClass).toBe("ordinary_web");
    expect(seededManifest.coveragePolicy.selectionDefault).toBe("full_manifest");
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-tg-1" },
      data: { provisionedAt: expect.any(Date) },
    });
  });

  it("does not seed repo bootstrap for direct-command managed projects", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: null,
        runnerBackend: "local",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "managed",
            runtimeConfig: { bootstrap: "direct_command" },
            sourceConfig: { recipeId: "simple_web" },
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
  });

  it("does not seed existing user-supplied agent-project repos", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: "https://github.com/example/user-repo",
        repoBranch: "main",
        runnerBackend: "local",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "git",
            runtimeConfig: {},
            sourceConfig: { recipe: "agent_project" },
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
  });

  it("does not create or seed repos when repoProvisioning is skipped", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        repoUrl: null,
        runnerBackend: "local",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "managed",
            runtimeConfig: { repoProvisioning: "skip" },
            sourceConfig: { recipe: "agent_project" },
          },
        ],
        proposal: null,
      },
    ]);

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 1, pausedInfra: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectComponent.update).toHaveBeenCalledWith({
      where: { id: "cmp-1" },
      data: { provisionedAt: expect.any(Date) },
    });
  });

  it("does not queue fresh managed agent-project repos when source seeding fails", async () => {
    process.env.GITHUB_TOKEN = "github-token";
    const fetchMock = mockGitHubProvisionerFetch({
      failContentPath: "server.mjs",
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(prisma.project.findMany as any).mockResolvedValue([
      {
        id: "proj-1",
        name: "Synth Jam",
        repoUrl: null,
        runnerBackend: "local",
        vpsHost: null,
        components: [
          {
            id: "cmp-1",
            kind: "app",
            sourceType: "managed",
            runtimeConfig: {},
            sourceConfig: { recipe: "agent_project" },
          },
        ],
        proposal: null,
      },
    ]);
    vi.mocked(requirePrimaryComponentRow as any).mockResolvedValue({
      componentId: "cmp-1",
      powerIntent: "ON",
      runtimeState: "ABSENT",
      agentState: "IDLE",
      blockers: [],
      retryCount: 0,
    });

    const res = await POST(
      new Request("http://localhost/api/cron/provisioner", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ provisioned: 0, pausedInfra: 1 });
    expect(prisma.project.update).not.toHaveBeenCalled();
    expect(prisma.projectComponent.update).not.toHaveBeenCalled();
    expect(appendLifecycle).not.toHaveBeenCalledWith("proj-1", "QUEUED");
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.anything(),
      "proj-1",
      { type: "addBlocker", blocker: "INFRA" },
      expect.objectContaining({
        source: "cron",
        trigger: "provisioner",
        reason: "provisioning_failed",
      }),
    );
  });
});

function mockGitHubProvisionerFetch(opts?: { failContentPath?: string }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "https://api.github.com/user") {
      return jsonResponse({ login: "example-owner" });
    }
    if (method === "POST" && url === "https://api.github.com/user/repos") {
      return jsonResponse({
        html_url: "https://github.com/example-owner/arena-synth-jam",
        full_name: "example-owner/arena-synth-jam",
        default_branch: "main",
      });
    }
    if (
      method === "GET" &&
      url === "https://api.github.com/repos/example-owner/arena-synth-jam/git/ref/heads/main"
    ) {
      return jsonResponse({ object: { sha: "base-sha" } });
    }
    if (
      method === "POST" &&
      url === "https://api.github.com/repos/example-owner/arena-synth-jam/git/refs"
    ) {
      return jsonResponse({ ref: "refs/heads/arena/project-proj-1" });
    }
    if (
      method === "PUT" &&
      url.startsWith("https://api.github.com/repos/example-owner/arena-synth-jam/contents/")
    ) {
      if (opts?.failContentPath && url.endsWith(`/contents/${opts.failContentPath}`)) {
        return new Response("seed failed", { status: 500 });
      }
      return jsonResponse({ content: { path: url.split("/contents/")[1] } });
    }
    return new Response(`Unexpected fetch ${method} ${url}`, { status: 500 });
  });
}

function readSeededGithubContent(fetchMock: ReturnType<typeof mockGitHubProvisionerFetch>, path: string): string {
  const call = fetchMock.mock.calls.find(([input, init]) =>
    String(input) === `https://api.github.com/repos/example-owner/arena-synth-jam/contents/${path}`
    && init?.method === "PUT"
  );
  if (!call) throw new Error(`Missing seeded GitHub content call for ${path}`);
  const body = JSON.parse(String(call[1]?.body ?? "{}")) as { content?: unknown };
  if (typeof body.content !== "string") throw new Error(`Missing base64 content for ${path}`);
  return Buffer.from(body.content, "base64").toString("utf8");
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
