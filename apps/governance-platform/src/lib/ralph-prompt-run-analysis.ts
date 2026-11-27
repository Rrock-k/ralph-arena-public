import type { RalphPromptDefinition } from "./ralph-prompts";
import type { RalphPromptTraceRun } from "./ralph-prompt-traces";

export type RalphPromptRunAnalysisStatus = "ok" | "warn" | "info";

export interface RalphPromptRunAnalysisItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  status: RalphPromptRunAnalysisStatus;
  eventId?: string;
  promptId?: string;
}

export function analyzeRalphPromptTraceRun(
  run: RalphPromptTraceRun | null,
  prompts: RalphPromptDefinition[],
): RalphPromptRunAnalysisItem[] {
  if (!run) {
    return [
      {
        id: "empty",
        label: "Observed run",
        value: "not selected",
        detail: "Select an observed run to see prompt-call health.",
        status: "info",
      },
    ];
  }

  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  const failedEvents = run.events.filter((event) => !event.success);
  const parseError = run.events.find((event) => event.parse.status === "error");
  const parseMissing = run.events.find(
    (event) => event.parse.status === "not_recorded",
  );
  const unlinkedSource = run.events.find(
    (event) => !promptIds.has(event.promptId),
  );

  return [
    {
      id: "calls",
      label: "Prompt calls",
      value: run.events.length > 0 ? `${run.events.length} captured` : "missing",
      detail:
        run.events.length > 0
          ? "Real model calls are captured for this run."
          : "The run exists, but no prompt calls were captured.",
      status: run.events.length > 0 ? "ok" : "warn",
      eventId: run.events[0]?.eventId,
    },
    {
      id: "failures",
      label: "Run outcome",
      value: failedEvents.length > 0 ? `${failedEvents.length} failed` : "no failed calls",
      detail:
        failedEvents.length > 0
          ? "At least one prompt call returned a failed result."
          : "No failed prompt calls are recorded in this trace.",
      status: failedEvents.length > 0 ? "warn" : "ok",
      eventId: failedEvents[0]?.eventId,
    },
    {
      id: "parse",
      label: "System decision",
      value: parseError ? "parse failed" : parseMissing ? "not recorded" : "recorded",
      detail: parseError
        ? "The parser reported an error for this prompt call."
        : parseMissing
          ? "The model response is captured, but parser/decision summary is not recorded yet."
          : "Parser/decision status is recorded for the prompt calls.",
      status: parseError ? "warn" : parseMissing ? "info" : "ok",
      eventId: parseError?.eventId ?? parseMissing?.eventId,
    },
    {
      id: "sources",
      label: "Prompt source",
      value: unlinkedSource ? "unlinked" : "linked",
      detail: unlinkedSource
        ? "This prompt id was observed in a run but is not in the prompt inventory."
        : "Observed prompt calls link back to the static prompt inventory.",
      status: unlinkedSource ? "warn" : "ok",
      eventId: unlinkedSource?.eventId,
    },
    {
      id: "file",
      label: "Trace file",
      value: run.errors.length > 0 ? `${run.errors.length} issues` : "clean",
      detail:
        run.errors.length > 0
          ? "The trace file has malformed lines; open the run to inspect parser errors."
          : "The trace file parsed cleanly.",
      status: run.errors.length > 0 ? "warn" : "ok",
    },
  ];
}
