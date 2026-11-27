import { describe, expect, it } from "vitest";
import { analyzeRalphPromptTraceRun } from "./ralph-prompt-run-analysis";
import type { RalphPromptDefinition } from "./ralph-prompts";
import type { PromptTraceEvent, RalphPromptTraceRun } from "./ralph-prompt-traces";

describe("Ralph prompt run analysis", () => {
  it("marks a clean observed run as linked and recorded", () => {
    const analysis = analyzeRalphPromptTraceRun(
      makeRun({
        events: [makeEvent()],
        errors: [],
      }),
      [makePrompt()],
    );

    expect(item(analysis, "calls")).toMatchObject({
      status: "ok",
      value: "1 captured",
      eventId: "evt-1",
    });
    expect(item(analysis, "sources")).toMatchObject({
      status: "ok",
      value: "linked",
    });
    expect(item(analysis, "parse")).toMatchObject({
      status: "ok",
      value: "recorded",
    });
  });

  it("links warnings to the concrete prompt call when possible", () => {
    const analysis = analyzeRalphPromptTraceRun(
      makeRun({
        events: [
          makeEvent({
            eventId: "evt-bad",
            promptId: "unknown.prompt",
            success: false,
            parse: { status: "error", summary: "bad json" },
          }),
        ],
        errors: ["Invalid prompt trace event at line 3"],
      }),
      [makePrompt()],
    );

    expect(item(analysis, "failures")).toMatchObject({
      status: "warn",
      value: "1 failed",
      eventId: "evt-bad",
    });
    expect(item(analysis, "parse")).toMatchObject({
      status: "warn",
      value: "parse failed",
      eventId: "evt-bad",
    });
    expect(item(analysis, "sources")).toMatchObject({
      status: "warn",
      value: "unlinked",
      eventId: "evt-bad",
    });
    expect(item(analysis, "file")).toMatchObject({
      status: "warn",
      value: "1 issues",
    });
  });
});

function item(items: ReturnType<typeof analyzeRalphPromptTraceRun>, id: string) {
  const found = items.find((candidate) => candidate.id === id);
  expect(found).toBeDefined();
  return found;
}

function makeRun(overrides: Partial<RalphPromptTraceRun> = {}): RalphPromptTraceRun {
  return {
    projectId: "project-1",
    projectName: "Project",
    workspaceLabel: "project",
    tracePath: "/tmp/prompt-trace.jsonl",
    eventCount: overrides.events?.length ?? 0,
    latestAt: "2026-05-17T00:00:00.000Z",
    events: [],
    errors: [],
    ...overrides,
  };
}

function makePrompt(overrides: Partial<RalphPromptDefinition> = {}): RalphPromptDefinition {
  return {
    id: "planner.initial",
    title: "Initial plan",
    owner: "planner",
    kind: "llm_prompt",
    templateStatus: "dynamic_builder",
    source: {
      file: "planner.ts",
      symbol: "buildPrompt",
    },
    bodyMode: "repository_template",
    templateBody: {
      source: "prompt_repository",
      format: "markdown_template",
      text: "{{spec}}",
      placeholders: ["spec"],
    },
    variables: [],
    visibility: "admin_raw",
    description: "Builds a plan.",
    descriptionRu: "Собирает plan.",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<PromptTraceEvent> = {}): PromptTraceEvent {
  return {
    schemaVersion: "ra-290.prompt-trace.v1",
    eventId: "evt-1",
    timestamp: "2026-05-17T00:00:00.000Z",
    eventType: "model_call",
    promptId: "planner.initial",
    owner: "planner",
    label: "Initial plan",
    success: true,
    context: {},
    prompt: {
      visibility: "admin_raw",
      charCount: 6,
      text: "prompt",
    },
    output: {
      visibility: "admin_raw",
      charCount: 6,
      text: "output",
    },
    parse: {
      status: "ok",
    },
    ...overrides,
  };
}
