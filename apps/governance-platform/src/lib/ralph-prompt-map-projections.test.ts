import { describe, expect, it } from "vitest";
import {
  buildObservedRunSummary,
  buildPromptRunTimelineItems,
  buildPromptAttentionItems,
  buildPromptUsageById,
  formatPromptUsageBadge,
  formatPromptUsageDetail,
} from "./ralph-prompt-map-projections";
import type { RalphPromptDefinition } from "./ralph-prompts";
import type {
  PromptTraceEvent,
  RalphPromptTraceMap,
  RalphPromptTraceRun,
} from "./ralph-prompt-traces";

describe("Ralph prompt map projections", () => {
  it("derives observed prompt usage from trace events", () => {
    const usage = buildPromptUsageById(
      makeTraceMap([
        makeRun({
          projectId: "run-a",
          projectName: "Run A",
          events: [makeEvent({ eventId: "evt-a", timestamp: "2026-05-17T01:00:00.000Z" })],
        }),
        makeRun({
          projectId: "run-b",
          projectName: "Run B",
          events: [
            makeEvent({
              eventId: "evt-b",
              success: false,
              timestamp: "2026-05-17T03:00:00.000Z",
            }),
          ],
        }),
      ]),
    );

    expect(usage.get("planner.initial")).toMatchObject({
      callCount: 2,
      failedCount: 1,
      lastAt: "2026-05-17T03:00:00.000Z",
      lastRunName: "Run B",
    });
    expect(formatPromptUsageBadge(usage.get("planner.initial"), "en")).toBe("failed 1");
    expect(formatPromptUsageDetail(usage.get("planner.initial"), "en")).toContain(
      "2 recorded calls, 1 failed.",
    );
    expect(formatPromptUsageDetail(usage.get("planner.initial"), "en")).toContain(
      "Last seen in Run B",
    );
  });

  it("keeps unseen prompt copy explicit without calling prompts unused", () => {
    expect(formatPromptUsageBadge(undefined, "en")).toBe("not seen yet");
    expect(formatPromptUsageDetail(undefined, "en")).toBe(
      "Not seen in recorded runs yet. This does not prove the prompt is unused.",
    );
  });

  it("derives attention items from explicit recorded issues", () => {
    const items = buildPromptAttentionItems(
      makeTraceMap([
        makeRun({
          errors: ["Invalid prompt trace event at line 2 with a long message"],
          events: [
            makeEvent({ eventId: "evt-failed", success: false }),
            makeEvent({
              eventId: "evt-parse",
              parse: { status: "error", summary: "bad json" },
            }),
            makeEvent({
              eventId: "evt-missing",
              parse: { status: "not_recorded" },
            }),
            makeEvent({
              eventId: "evt-source",
              promptId: "unknown.prompt",
            }),
          ],
        }),
      ]),
      [makePrompt()],
      "en",
    );

    expect(items.map((item) => item.label)).toEqual([
      "Model call failed",
      "Decision unclear",
      "No system decision",
      "Prompt source missing",
      "Run story incomplete",
    ]);
    expect(items.find((item) => item.label === "Decision unclear")).toMatchObject({
      eventId: "evt-parse",
      detail: "Project · bad json",
    });
    expect(items.find((item) => item.label === "Prompt source missing")).toMatchObject({
      eventId: "evt-source",
      value: "unknown.prompt",
    });
  });

  it("orders attention items by actionability and then recency", () => {
    const items = buildPromptAttentionItems(
      makeTraceMap([
        makeRun({
          projectId: "run-a",
          projectName: "Run A",
          latestAt: "2026-05-17T06:00:00.000Z",
          errors: ["trace issue"],
          events: [
            makeEvent({
              eventId: "evt-source",
              promptId: "unknown.prompt",
              timestamp: "2026-05-17T06:00:00.000Z",
            }),
            makeEvent({
              eventId: "evt-old-failure",
              success: false,
              timestamp: "2026-05-17T04:00:00.000Z",
            }),
          ],
        }),
        makeRun({
          projectId: "run-b",
          projectName: "Run B",
          latestAt: "2026-05-17T05:00:00.000Z",
          events: [
            makeEvent({
              eventId: "evt-new-failure",
              success: false,
              timestamp: "2026-05-17T05:00:00.000Z",
            }),
            makeEvent({
              eventId: "evt-parse",
              parse: { status: "error", summary: "bad json" },
              timestamp: "2026-05-17T05:10:00.000Z",
            }),
          ],
        }),
      ]),
      [makePrompt()],
      "en",
    );

    expect(items.map((item) => item.id)).toEqual([
      "evt-new-failure:failed-call",
      "evt-old-failure:failed-call",
      "evt-parse:decision-unreadable",
      "evt-source:source-missing",
      "run-a:trace-file:0",
    ]);
  });

  it("summarizes a selected observed run without creating lifecycle truth", () => {
    const run = makeRun({
      projectId: "run-a",
      projectName: "Run A",
      latestAt: "2026-05-17T06:00:00.000Z",
      errors: ["bad trace line"],
      events: [
        makeEvent({ eventId: "evt-ok", parse: { status: "ok", summary: "ship" } }),
        makeEvent({ eventId: "evt-failed", success: false }),
        makeEvent({ eventId: "evt-missing", parse: { status: "not_recorded" } }),
      ],
    });
    const attentionItems = buildPromptAttentionItems(makeTraceMap([run]), [makePrompt()], "en");

    expect(buildObservedRunSummary(run, [makePrompt()], attentionItems, "en")).toMatchObject({
      tone: "warn",
      headline: "Needs review",
      nextIssue: {
        id: "evt-failed:failed-call",
      },
      metrics: [
        { id: "calls", value: "3", tone: "ok" },
        { id: "failures", value: "1", tone: "warn" },
        { id: "decisions", value: "1 missing", tone: "info" },
        { id: "sources", value: "linked", tone: "ok" },
        { id: "trace-file", value: "1 issues", tone: "warn" },
      ],
    });
  });

  it("builds prompt-run timeline items in recorded order", () => {
    const timeline = buildPromptRunTimelineItems(
      makeRun({
        events: [
          makeEvent({
            eventId: "evt-a",
            label: "Initial plan",
            parse: { status: "ok", summary: "created plan" },
          }),
          makeEvent({
            eventId: "evt-b",
            label: "Controller review",
            parse: { status: "error", summary: "bad json" },
          }),
        ],
      }),
      "en",
    );

    expect(timeline).toEqual([
      {
        id: "evt-a",
        eventId: "evt-a",
        stepLabel: "Step 01",
        title: "Initial plan",
        meta: "planner · planner.initial",
        detail: "System chose · created plan",
        tone: "ok",
      },
      {
        id: "evt-b",
        eventId: "evt-b",
        stepLabel: "Step 02",
        title: "Controller review",
        meta: "planner · planner.initial",
        detail: "Decision unreadable · bad json",
        tone: "warn",
      },
    ]);
  });
});

function makeTraceMap(runs: RalphPromptTraceRun[]): RalphPromptTraceMap {
  return {
    workspaceRoot: "/tmp",
    runs,
  };
}

function makeRun(overrides: Partial<RalphPromptTraceRun> = {}): RalphPromptTraceRun {
  const events = overrides.events ?? [];

  return {
    projectId: "project-1",
    projectName: "Project",
    workspaceLabel: "project",
    tracePath: "/tmp/prompt-trace.jsonl",
    eventCount: events.length,
    latestAt: events[events.length - 1]?.timestamp ?? null,
    events,
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
