import { describe, expect, it } from "vitest";
import { getRalphPromptMap } from "./ralph-prompts";

describe("Ralph prompt map", () => {
  it("projects the runtime prompt export into owner groups", () => {
    const map = getRalphPromptMap({
      generatedAt: "2026-05-17T00:00:00.000Z",
    });

    expect(map.export.schemaVersion).toBe("ra-310.prompt-repository.v12");
    expect(map.export.generatedAt).toBe("2026-05-17T00:00:00.000Z");
    expect(map.export.owner).toBe("packages/loops/ralph-runtime/src/prompts");
    expect(map.export.bodyContract.templateBodies).toBe("repository_owned");
    expect(map.export.bodyContract.renderedBodies).toBe("prompt_trace");
    expect(map.counts.total).toBe(map.export.entries.length);
    expect(map.ownerGroups.map((group) => group.owner)).toEqual([
      "planner",
      "executor",
      "controller",
      "qa-planner",
      "vision-qa",
    ]);
    expect(map.ownerGroups.find((group) => group.owner === "planner")?.promptIds).toContain("planner.initial");
    expect(map.ownerGroups.find((group) => group.owner === "executor")?.promptIds).toContain("executor.taskSection");
    expect(map.export.entries.find((entry) => entry.id === "planner.initial")?.descriptionRu).toContain("execution plan");
  });

  it("keeps admin-only raw prompts distinguishable from safe summaries", () => {
    const map = getRalphPromptMap({
      generatedAt: "2026-05-17T00:00:00.000Z",
    });

    expect(map.counts.byVisibility.admin_raw).toBeGreaterThan(0);
    expect(map.counts.byVisibility.safe_summary).toBeGreaterThan(0);
    expect(map.counts.byVisibility.admin_raw + map.counts.byVisibility.safe_summary).toBe(map.counts.total);
  });

  it("exposes repository-owned template bodies without rendering run text", () => {
    const map = getRalphPromptMap({
      generatedAt: "2026-05-17T00:00:00.000Z",
    });
    const projectGoal = map.export.entries.find((entry) => entry.id === "executor.projectGoalSection");
    const controllerAudit = map.export.entries.find((entry) => entry.id === "controller.audit");
    const initialPlanner = map.export.entries.find((entry) => entry.id === "planner.initial");
    const specMigration = map.export.entries.find((entry) => entry.id === "planner.specMigration");
    const agentPrompt = map.export.entries.find((entry) => entry.id === "executor.agentPrompt");

    expect(map.export.entries.find((entry) => entry.id === "executor.ralphArenaBoundary")).toBeUndefined();
    expect(map.export.entries.find((entry) => entry.id === "executor.legacyInstructions")).toBeUndefined();
    expect(projectGoal?.bodyMode).toBe("repository_template");
    expect(projectGoal?.templateBody?.placeholders).toEqual(["projectGoal"]);
    expect(controllerAudit?.bodyMode).toBe("repository_template");
    expect(controllerAudit?.templateBody?.text).toContain("# Role: Project Controller (Auditor)");
    expect(initialPlanner?.bodyMode).toBe("repository_template");
    expect(initialPlanner?.templateBody?.text).toContain("# Role: Project Planner");
    expect(specMigration?.bodyMode).toBe("repository_template");
    expect(specMigration?.templateBody?.text).toContain("# Role: Incremental Planner");
    expect(agentPrompt?.bodyMode).toBe("repository_template");
    expect(agentPrompt?.templateBody?.placeholders).toEqual(["contextSections"]);
  });

  it("keeps exported prompt bodies repository-owned", () => {
    const map = getRalphPromptMap({
      generatedAt: "2026-05-17T00:00:00.000Z",
    });

    const filesSection = map.export.entries.find((entry) => entry.id === "executor.filesSection");
    expect(map.export.entries.every((entry) => entry.templateBody || entry.bodyPreview)).toBe(true);
    expect(filesSection).toBeUndefined();
    expect(map.export.entries.some((entry) => entry.bodyMode === "runtime_artifact")).toBe(false);
  });

  it("keeps context-section composition links in the runtime export", () => {
    const map = getRalphPromptMap({
      generatedAt: "2026-05-17T00:00:00.000Z",
    });

    const taskSection = map.export.entries.find((entry) => entry.id === "executor.taskSection");
    const agentPrompt = map.export.entries.find((entry) => entry.id === "executor.agentPrompt");
    const qaTaskTemplate = map.export.entries.find((entry) => entry.id === "qaPlanner.writeTestRequestTask");
    const usedByAgentPrompt = map.export.entries.filter((entry) => entry.usedByEntryIds?.includes("executor.agentPrompt"));

    expect(agentPrompt?.kind).toBe("llm_prompt");
    expect(taskSection?.kind).toBe("context_section");
    expect(qaTaskTemplate?.kind).toBe("task_template");
    expect(taskSection?.usedByEntryIds).toEqual(["executor.agentPrompt"]);
    expect(qaTaskTemplate?.usedByEntryIds).toEqual(["executor.taskSection"]);
    expect(usedByAgentPrompt.length).toBeGreaterThan(7);
  });
});
