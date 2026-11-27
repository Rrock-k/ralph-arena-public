import { describe, expect, it } from "vitest";

import { mergeOpsProjectSnapshots, shouldPollSelectedOpsProject } from "./live-project-merge";
import type { OpsProject } from "./OpsDashboard";

function project(id: string, status: string): OpsProject {
  return {
    id,
    status,
    agent: "codex",
    agentImpl: "ralph",
    createdAt: "2026-04-16T00:00:00.000Z",
    updatedAt: "2026-04-16T00:00:00.000Z",
    visualEvidenceMode: "off",
    requiredSecrets: [],
    secrets: [],
    runLogs: [],
    specs: [],
    assets: [],
  };
}

describe("mergeOpsProjectSnapshots", () => {
  it("keeps object identity for untouched partial updates", () => {
    const first = project("project-1", "LIVE");
    const second = project("project-2", "IDLE");

    const merged = mergeOpsProjectSnapshots([first, second], [{ ...second, status: "RUNNING" }], {
      mode: "partial",
      requestedIds: ["project-2"],
    });

    expect(merged[0]).toBe(first);
    expect(merged[1]).not.toBe(second);
    expect(merged[1]?.status).toBe("RUNNING");
  });

  it("drops missing projects on full refresh and preserves equal rows", () => {
    const first = project("project-1", "LIVE");
    const second = project("project-2", "IDLE");

    const merged = mergeOpsProjectSnapshots([first, second], [project("project-1", "LIVE")], {
      mode: "full",
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(first);
  });

  it("adds newly created projects on full refresh", () => {
    const first = project("project-1", "LIVE");
    const created = project("project-3", "IDLE");

    const merged = mergeOpsProjectSnapshots([first], [created, project("project-1", "LIVE")], {
      mode: "full",
    });

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(created);
    expect(merged[1]).toBe(first);
  });
});

describe("shouldPollSelectedOpsProject", () => {
  it("detects selected Ops rows that need read-side convergence polling", () => {
    expect(shouldPollSelectedOpsProject({
      ...project("project-1", "BUILDING"),
      components: [{ kind: "app", powerIntent: "OFF", runtimeState: "RUNNING" }],
    })).toBe(true);

    expect(shouldPollSelectedOpsProject({
      ...project("project-1", "BUILDING"),
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "ABSENT" }],
    })).toBe(true);

    expect(shouldPollSelectedOpsProject({
      ...project("project-1", "PAUSED"),
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "RUNNING", blockers: ["INFRA"] }],
    })).toBe(true);

    expect(shouldPollSelectedOpsProject({
      ...project("project-1", "PAUSED"),
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "RUNNING", retryAt: "2026-06-08T17:00:00.000Z" }],
    })).toBe(true);
  });

  it("does not poll parked or running-converged rows", () => {
    expect(shouldPollSelectedOpsProject({
      ...project("project-1", "PAUSED"),
      components: [{ kind: "app", powerIntent: "OFF", runtimeState: "ABSENT" }],
    })).toBe(false);

    expect(shouldPollSelectedOpsProject({
      ...project("project-1", "LIVE"),
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "RUNNING" }],
    })).toBe(false);

    expect(shouldPollSelectedOpsProject({
      ...project("project-1", "PAUSED"),
      components: [{ kind: "app", powerIntent: "ON", runtimeState: "STOPPED" }],
    })).toBe(false);
  });
});
