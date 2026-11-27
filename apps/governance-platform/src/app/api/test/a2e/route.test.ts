import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/test-mode", () => ({
  isTestModeEnabledForRequest: vi.fn(() => true),
}));

vi.mock("@/app/actions/launch", () => ({
  launchProposal: vi.fn(),
}));

vi.mock("@/app/actions/secrets", () => ({
  createProjectSecretInternal: vi.fn(),
}));

vi.mock("@/app/actions/budget", () => ({
  addProjectCreditsInternal: vi.fn(),
  setProjectBudgetLimitInternal: vi.fn(),
}));

vi.mock("@/app/actions/specs", () => ({
  createSpecInternal: vi.fn(),
}));

vi.mock("@/app/actions/agent-intent", () => ({
  setAgentIntentInternal: vi.fn(),
}));

vi.mock("@/app/actions/power-intent", () => ({
  setPowerIntentInternal: vi.fn(),
}));

vi.mock("@/app/actions/relaunch", () => ({
  relaunchProjectInternal: vi.fn(),
}));

vi.mock("@/app/actions/project-manage", () => ({
  deleteProjectInternal: vi.fn(),
}));

vi.mock("@/app/actions/archive", () => ({
  archiveProjectInternal: vi.fn(),
  unarchiveProjectInternal: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {},
  },
}));

vi.mock("@/lib/project-recipes", () => ({
  getProjectRecipe: vi.fn(() => null),
}));

vi.mock("@/lib/control-plane", () => ({
  getProjectState: vi.fn(),
  getWorkerSnapshot: vi.fn(),
}));

vi.mock("@/lib/display-status", () => ({
  getDisplayStatus: vi.fn(() => "PAUSED"),
}));

import { POST } from "./route";
import { normalizeInitialAgentIntent, shouldSkipRepoProvisioningForHostRepo } from "./route";
import { setAgentIntentInternal } from "@/app/actions/agent-intent";
import { setPowerIntentInternal } from "@/app/actions/power-intent";
import { relaunchProjectInternal } from "@/app/actions/relaunch";
import { archiveProjectInternal, unarchiveProjectInternal } from "@/app/actions/archive";
import { prisma } from "@/lib/prisma";
import { getProjectState, getWorkerSnapshot } from "@/lib/control-plane";
import { INTERNAL_ACTION_TOKEN } from "@/lib/internal-action-token";

async function post(body: Record<string, unknown>) {
  const req = new Request("http://localhost/api/test/a2e", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req);
}

describe("POST /api/test/a2e lifecycle actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setAgentIntentInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(setPowerIntentInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(relaunchProjectInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(archiveProjectInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(unarchiveProjectInternal).mockResolvedValue({ success: true } as any);
    vi.mocked(getProjectState).mockResolvedValue(null as any);
    vi.mocked(getWorkerSnapshot).mockResolvedValue(null as any);
  });

  it("maps agent_on to explicit agent intent ON", async () => {
    const res = await post({ action: "agent_on", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(setAgentIntentInternal).toHaveBeenCalledWith("project-1", "ON", INTERNAL_ACTION_TOKEN);
  });

  it("maps agent_off to explicit agent intent OFF", async () => {
    const res = await post({ action: "agent_off", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(setAgentIntentInternal).toHaveBeenCalledWith("project-1", "OFF", INTERNAL_ACTION_TOKEN);
  });

  it("maps power_on to explicit app power ON", async () => {
    const res = await post({ action: "power_on", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(setPowerIntentInternal).toHaveBeenCalledWith("project-1", "ON", INTERNAL_ACTION_TOKEN);
  });

  it("maps power_off to explicit app power OFF", async () => {
    const res = await post({ action: "power_off", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(setPowerIntentInternal).toHaveBeenCalledWith("project-1", "OFF", INTERNAL_ACTION_TOKEN);
  });

  it("maps archive_project to project archive primitive", async () => {
    const res = await post({ action: "archive_project", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(archiveProjectInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
  });

  it("maps unarchive_project to project unarchive primitive", async () => {
    const res = await post({ action: "unarchive_project", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(unarchiveProjectInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
  });

  it("maps relaunch_project to explicit relaunch primitive", async () => {
    const res = await post({ action: "relaunch_project", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(relaunchProjectInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
  });

  it("executes unarchive_then_power_on as explicit composite flow", async () => {
    const res = await post({ action: "unarchive_then_power_on", projectId: "project-1" });

    expect(res.status).toBe(200);
    expect(unarchiveProjectInternal).toHaveBeenCalledWith("project-1", INTERNAL_ACTION_TOKEN);
    expect(setPowerIntentInternal).toHaveBeenCalledWith("project-1", "ON", INTERNAL_ACTION_TOKEN);
  });

  it("stops composite flow when unarchive fails", async () => {
    vi.mocked(unarchiveProjectInternal).mockResolvedValue({ success: false, error: "Project not found" } as any);

    const res = await post({ action: "unarchive_then_power_on", projectId: "project-1" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: "Project not found" });
    expect(setPowerIntentInternal).not.toHaveBeenCalled();
  });

  it("rejects removed legacy actions", async () => {
    const res = await post({ action: "resume_project", projectId: "project-1" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Unsupported action" });
    expect(relaunchProjectInternal).not.toHaveBeenCalled();
  });

  it("serializes codexAuthMode in state responses", async () => {
    vi.mocked(getProjectState).mockResolvedValue({
      id: "project-1",
      mode: "PROJECT",
      archivedAt: null,
      agent: "codex",
      agentImpl: "ralph",
      model: "gpt-5.4",
      codexAuthMode: "subscription",
      runnerBackend: "local_docker",
      name: "A2E project",
      repoUrl: null,
      repoBranch: null,
      previewUrl: null,
      requiredSecrets: [],
      createdAt: new Date("2026-04-16T00:00:00.000Z"),
      updatedAt: new Date("2026-04-16T00:00:00.000Z"),
      proposal: null,
      budget: null,
      secrets: [],
      specs: [],
      components: [],
      vpsHost: null,
      startedAt: null,
      finishedAt: null,
      containerName: null,
      workerHost: null,
      lastError: null,
      progressJson: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null,
      budgetDebitedUsd: null,
      runLogs: [],
    } as any);

    const res = await post({ action: "state", projectId: "project-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.codexAuthMode).toBe("subscription");
  });

  it("delegates worker_snapshot to the shared control-plane helper", async () => {
    vi.mocked(getWorkerSnapshot).mockResolvedValue({
      projectId: "project-1",
      workerUrl: "http://worker.local",
      meta: null,
      inspect: null,
      logs: null,
      parity: null,
      errors: { meta: null, inspect: null, logs: null },
    } as any);

    const res = await post({ action: "worker_snapshot", projectId: "project-1" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(getWorkerSnapshot).toHaveBeenCalledWith("project-1");
    expect(body.projectId).toBe("project-1");
  });

  it("skips repo provisioning for A2E host-repo mode", () => {
    expect(shouldSkipRepoProvisioningForHostRepo(JSON.stringify({ ARENA_MOUNT_HOST_REPO: "1" }))).toBe(true);
    expect(shouldSkipRepoProvisioningForHostRepo(JSON.stringify({ ARENA_MOUNT_HOST_REPO: "0" }))).toBe(false);
    expect(shouldSkipRepoProvisioningForHostRepo(null)).toBe(false);
  });

  it("normalizes initial A2E agent intent strictly", () => {
    expect(normalizeInitialAgentIntent("OFF")).toBe("OFF");
    expect(normalizeInitialAgentIntent("ON")).toBe("ON");
    expect(normalizeInitialAgentIntent("junk")).toBe("ON");
    expect(normalizeInitialAgentIntent(null)).toBe("ON");
  });

});
