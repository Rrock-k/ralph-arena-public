"use client";

import { useState } from "react";
import type { RalphPromptDefinition } from "@/lib/ralph-prompts";
import type {
  PromptTraceEvent,
  RalphPromptTraceMap,
} from "@/lib/ralph-prompt-traces";
import {
  buildObservedRunSummary,
  buildPromptAttentionItems,
  buildPromptRunTimelineItems,
  type PromptAttentionItem,
  type PromptMapLanguage,
  type PromptRunTimelineItem,
} from "@/lib/ralph-prompt-map-projections";

interface PromptMapObservedRunsViewProps {
  traceMap: RalphPromptTraceMap;
  prompts: RalphPromptDefinition[];
  selectedEvent: PromptTraceEvent | null;
  onSelectRun: (projectId: string) => void;
  onSelectEvent: (eventId: string) => void;
  onShowRunTable: () => void;
  onSelectAttentionItem: (item: PromptAttentionItem) => void;
  onOpenPromptDefinition: (promptId: string) => void;
  language: PromptMapLanguage;
}

export function PromptMapObservedRunsView({
  traceMap,
  prompts,
  selectedEvent,
  onSelectRun,
  onSelectEvent,
  onShowRunTable,
  onSelectAttentionItem,
  onOpenPromptDefinition,
  language,
}: PromptMapObservedRunsViewProps) {
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const copy = OBSERVED_RUNS_COPY[language];

  if (traceMap.runs.length === 0) {
    return (
      <div className="empty">
        <strong>{copy.emptyTitle}</strong>
        <p>{copy.emptyText}</p>
      </div>
    );
  }

  const attentionItems = buildPromptAttentionItems(traceMap, prompts, language);
  const runRows = traceMap.runs.map((run) => {
    const runAttentionItems = attentionItems.filter(
      (item) => item.projectId === run.projectId,
    );
    const summary = buildObservedRunSummary(run, prompts, runAttentionItems, language);

    return {
      run,
      runAttentionItems,
      summary,
      nextIssue: summary.nextIssue,
    };
  });
  const openRun = openRunId
    ? traceMap.runs.find((run) => run.projectId === openRunId) ?? null
    : null;
  const openRunRow = openRun
    ? runRows.find((row) => row.run.projectId === openRun.projectId) ?? null
    : null;

  function openRunDetails(projectId: string) {
    onSelectRun(projectId);
    setOpenRunId(projectId);
  }

  function closeRunDetails() {
    setOpenRunId(null);
    onShowRunTable();
  }

  if (!openRun || !openRunRow) {
    return (
      <ObservedRunsTable rows={runRows} onOpenRun={openRunDetails} language={language} />
    );
  }

  const runAttentionItems = openRunRow.runAttentionItems;
  const runSummary = openRunRow.summary;
  const timelineItems = buildPromptRunTimelineItems(openRun, language);
  const nextIssue = runSummary.nextIssue;
  const selectedEventBelongsToOpenRun = selectedEvent
    ? openRun.events.some((event) => event.eventId === selectedEvent.eventId)
    : false;
  const selectedDetailEvent = selectedEventBelongsToOpenRun
    ? selectedEvent
    : openRun.events[openRun.events.length - 1] ?? null;
  const readout = buildRunReadout(runSummary, nextIssue, selectedDetailEvent, language);

  return (
    <div className="observedRuns">
      <div className="detailBar">
        <button className="btn" type="button" onClick={closeRunDetails}>
          {copy.backToRuns}
        </button>
        <div>
          <span>{copy.runDetail}</span>
          <b>{openRun.projectName}</b>
        </div>
      </div>

      <section className={`runHero ${runSummary.tone}`}>
        <div>
          <span className="eyebrow">{copy.observedRun}</span>
          <h2>{openRun.projectName}</h2>
          <p>{runSummary.headline}</p>
          <small>{runSummary.detail} · {copy.recordedOnly}</small>
        </div>
        {nextIssue ? (
          <button
            className="nextIssue"
            type="button"
            onClick={() => {
              onSelectAttentionItem(nextIssue);
              setOpenRunId(nextIssue.projectId);
            }}
          >
            <span>{copy.nextIssue}</span>
            <b>{nextIssue.label}</b>
            <small>{nextIssue.detail}</small>
          </button>
        ) : (
          <div className="nextIssue clear">
            <span>{copy.nextIssue}</span>
            <b>{copy.noRecordedIssues}</b>
            <small>{copy.notLifecycleVerdict}</small>
          </div>
        )}
      </section>

      <div className="runReadout">
        {readout.map((item) => (
          <div className={`readoutCard ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <b>{item.value}</b>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>

      <details className="metricDetails">
        <summary>{copy.evidenceCounters}</summary>
        <div className="runMetrics">
          {runSummary.metrics.map((metric) => (
            <div className={`metric ${metric.tone}`} key={metric.id} title={metric.detail}>
              <span>{metric.label}</span>
              <b>{metric.value}</b>
            </div>
          ))}
        </div>
      </details>

      <div className="observedLayout">
        <RunStoryTimeline
          items={timelineItems}
          selectedEventId={selectedDetailEvent?.eventId ?? ""}
          onSelectEvent={onSelectEvent}
          language={language}
        />

        <div className="panel callPanel">
          <div className="previewHead">
            <span>{selectedDetailEvent?.label ?? copy.selectedStep}</span>
            {selectedDetailEvent && (
              <button
                className="link"
                type="button"
                onClick={() => onOpenPromptDefinition(selectedDetailEvent.promptId)}
              >
                {copy.openPromptDefinition}
              </button>
            )}
          </div>
          <PromptCallStory event={selectedDetailEvent} prompts={prompts} language={language} />
        </div>
      </div>

      {runAttentionItems.length > 1 && (
        <details className="issueDetails">
          <summary>{copy.allIssues} ({runAttentionItems.length})</summary>
          <div className="issueList">
            {runAttentionItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectAttentionItem(item)}
              >
                <span>{item.label}</span>
                <b>{item.value}</b>
                <small>{item.detail}</small>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ObservedRunsTable({
  rows,
  onOpenRun,
  language,
}: {
  rows: Array<{
    run: RalphPromptTraceMap["runs"][number];
    summary: ReturnType<typeof buildObservedRunSummary>;
    nextIssue: PromptAttentionItem | null;
  }>;
  onOpenRun: (projectId: string) => void;
  language: PromptMapLanguage;
}) {
  const copy = OBSERVED_RUNS_COPY[language];

  return (
    <div className="observedRuns">
      <section className="panel runsTablePanel">
        <div className="previewHead">
          <span>Runs</span>
          <span>{rows.length} {copy.observedCount}</span>
        </div>
        <div className="runsTableWrap">
          <table className="runsTable">
            <thead>
              <tr>
                <th>Run</th>
                <th>{copy.status}</th>
                <th>Calls</th>
                <th>{copy.latest}</th>
                <th>{copy.nextIssue}</th>
                <th>Trace</th>
                <th>
                  <span className="srOnly">{copy.action}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ run, summary, nextIssue }) => (
                <tr key={run.projectId}>
                  <td>
                    <strong>{run.projectName}</strong>
                    <small>{run.projectId}</small>
                  </td>
                  <td>
                    <span className={`runStatus ${summary.tone}`}>
                      {summary.headline}
                    </span>
                  </td>
                  <td>{run.eventCount}</td>
                  <td>{formatTraceTime(run.latestAt, language)}</td>
                  <td>{nextIssue?.label ?? copy.none}</td>
                  <td>{run.errors.length > 0 ? `${run.errors.length} ${copy.issues}` : copy.clean}</td>
                  <td>
                    <button
                      className="link"
                      type="button"
                      onClick={() => onOpenRun(run.projectId)}
                    >
                      {copy.open}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RunStoryTimeline({
  items,
  selectedEventId,
  onSelectEvent,
  language,
}: {
  items: PromptRunTimelineItem[];
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  language: PromptMapLanguage;
}) {
  const copy = OBSERVED_RUNS_COPY[language];

  return (
    <div className="panel timelinePanel">
      <div className="previewHead">
        <span>Run story</span>
        <span>{copy.selectStep}</span>
      </div>
      {items.length ? (
        <div className="timeline">
          {items.map((item) => (
            <button
              key={item.id}
              className={`timelineStep ${selectedEventId === item.eventId ? "active" : ""} ${item.tone}`}
              title={item.meta}
              type="button"
              onClick={() => onSelectEvent(item.eventId)}
            >
              <span className="stepIndex">{item.stepLabel}</span>
              <strong>{item.title}</strong>
              <small>{item.meta}</small>
              <em>{item.detail}</em>
            </button>
          ))}
        </div>
      ) : (
        <div className="emptyInline">{copy.noPromptCalls}</div>
      )}
    </div>
  );
}

function PromptCallStory({
  event,
  prompts,
  language,
}: {
  event: PromptTraceEvent | null;
  prompts: RalphPromptDefinition[];
  language: PromptMapLanguage;
}) {
  const copy = OBSERVED_RUNS_COPY[language];

  if (!event) {
    return <div className="emptyInline">{copy.selectRunStep}</div>;
  }

  const promptDefinition = findPromptDefinition(event.promptId, prompts);
  const contextEntries = Object.entries(event.context);

  return (
    <div className="story">
      <div className="storyStep">
        <label>1. Prompt call</label>
        <strong>{event.label}</strong>
        <small>
          {event.owner} · {event.promptId}
          {promptDefinition ? ` · ${formatSource(promptDefinition)}` : ` · ${copy.sourceNotFound}`}
        </small>
      </div>

      <div className="storyStep">
        <label>2. Model answer</label>
        <strong>{event.success ? copy.received : copy.failed}</strong>
        <small>{truncateText(event.output.text, 260)}</small>
      </div>

      <div className="storyStep important">
        <label>3. System read</label>
        <strong>{formatParseStatus(event.parse.status, language)}</strong>
        <small>{event.parse.summary ?? copy.noDecisionSummary}</small>
      </div>

      <details>
        <summary>{copy.recordedInputs}</summary>
        <div className="content">
          {contextEntries.length > 0
            ? contextEntries.map(([key, value]) => (
              <div className="kv" key={key}>
                <span>{key}</span>
                <b>{String(value)}</b>
              </div>
            ))
            : copy.noContextValues}
        </div>
      </details>

      <details>
        <summary>full prompt ({event.prompt.charCount} chars)</summary>
        <pre>{event.prompt.text}</pre>
      </details>

      <details>
        <summary>full model answer ({event.output.charCount} chars)</summary>
        <pre>{event.output.text}</pre>
      </details>

      <RawDetails value={event} language={language} />
    </div>
  );
}

function RawDetails({ value, language }: { value: unknown; language: PromptMapLanguage }) {
  return (
    <details>
      <summary>{OBSERVED_RUNS_COPY[language].rawTraceEvent}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function buildRunReadout(
  runSummary: ReturnType<typeof buildObservedRunSummary>,
  nextIssue: PromptAttentionItem | null,
  selectedEvent: PromptTraceEvent | null,
  language: PromptMapLanguage,
) {
  const copy = OBSERVED_RUNS_COPY[language];

  return [
    {
      label: copy.status,
      value: runSummary.headline,
      detail: copy.traceOnly,
      tone: runSummary.tone,
    },
    {
      label: "Focus",
      value: nextIssue?.label ?? copy.readStory,
      detail: nextIssue?.detail ?? copy.noPrioritizedIssue,
      tone: nextIssue ? "warn" : "ok",
    },
    {
      label: copy.selectedStep,
      value: selectedEvent?.label ?? copy.nothingSelected,
      detail: selectedEvent
        ? formatParseStatus(selectedEvent.parse.status, language)
        : copy.pickStep,
      tone: selectedEvent ? getEventTone(selectedEvent) : "info",
    },
  ] as const;
}

function getEventTone(event: PromptTraceEvent) {
  if (!event.success || event.parse.status === "error") return "warn";
  if (event.parse.status === "not_recorded") return "info";
  return "ok";
}

function findPromptDefinition(
  promptId: string,
  prompts: RalphPromptDefinition[],
): RalphPromptDefinition | null {
  return prompts.find((prompt) => prompt.id === promptId) ?? null;
}

function formatSource(prompt: RalphPromptDefinition) {
  return `${prompt.source.file} · ${prompt.source.symbol}${
    prompt.source.lineHint ? `:${prompt.source.lineHint}` : ""
  }`;
}

function formatParseStatus(status: PromptTraceEvent["parse"]["status"], language: PromptMapLanguage) {
  if (language === "ru") {
    if (status === "ok") return "Parsed decision записан";
    if (status === "error") return "Decision не прочитан";
    return "Parsed decision не записан";
  }

  if (status === "ok") return "Parsed decision recorded";
  if (status === "error") return "Could not read decision";
  return "No parsed decision recorded";
}

function formatTraceTime(value: string | null, language: PromptMapLanguage) {
  if (!value) return OBSERVED_RUNS_COPY[language].noEvents;

  try {
    return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function truncateText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "empty response";
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

const OBSERVED_RUNS_COPY = {
  ru: {
    action: "Действие",
    allIssues: "Все recorded issues в этом Run",
    backToRuns: "назад к Runs",
    clean: "clean",
    emptyText: "Static prompt inventory доступен. Запусти проект на обновлённом Ralph runtime, чтобы увидеть реальные prompt calls.",
    emptyTitle: "Observed Runs пока нет.",
    evidenceCounters: "evidence counters",
    failed: "failed",
    issues: "issues",
    latest: "Latest",
    nextIssue: "Next issue",
    noContextValues: "Context values не записаны.",
    noDecisionSummary: "Decision summary для этого call пока нет.",
    noEvents: "нет events",
    noPrioritizedIssue: "Сейчас нет prioritized prompt issue.",
    noPromptCalls: "Для этого Run не записаны prompt calls.",
    noRecordedIssues: "Prompt issues не записаны",
    none: "none",
    notLifecycleVerdict: "Это не lifecycle success signal.",
    nothingSelected: "Ничего не выбрано",
    observedCount: "observed",
    observedRun: "Observed Run",
    open: "open",
    openPromptDefinition: "открыть Prompt definition",
    pickStep: "Выбери step ниже.",
    rawTraceEvent: "raw trace event",
    readStory: "Read the story",
    received: "received",
    recordedInputs: "recorded inputs",
    recordedOnly: "recorded calls only",
    runDetail: "Run detail",
    selectRunStep: "Выбери step, чтобы посмотреть, что произошло.",
    selectStep: "выбери step",
    selectedStep: "Selected step",
    sourceNotFound: "source not found",
    status: "Status",
    traceOnly: "Только Prompt trace. Это не lifecycle verdict.",
  },
  en: {
    action: "Action",
    allIssues: "All recorded issues in this Run",
    backToRuns: "back to Runs",
    clean: "clean",
    emptyText: "Static prompt inventory is still available. Run a project with the updated Ralph runtime to inspect real prompt calls here.",
    emptyTitle: "No observed runs yet.",
    evidenceCounters: "evidence counters",
    failed: "failed",
    issues: "issues",
    latest: "Latest",
    nextIssue: "Next issue",
    noContextValues: "No context values recorded.",
    noDecisionSummary: "No decision summary for this call yet.",
    noEvents: "no events",
    noPrioritizedIssue: "No recorded prompt issue is currently prioritized.",
    noPromptCalls: "No recorded prompt calls for this Run.",
    noRecordedIssues: "No recorded prompt issues",
    none: "none",
    notLifecycleVerdict: "This is not a lifecycle success signal.",
    nothingSelected: "Nothing selected",
    observedCount: "observed",
    observedRun: "Observed Run",
    open: "open",
    openPromptDefinition: "open Prompt definition",
    pickStep: "Pick a Run step below.",
    rawTraceEvent: "raw trace event",
    readStory: "Read the story",
    received: "received",
    recordedInputs: "recorded inputs",
    recordedOnly: "recorded calls only",
    runDetail: "Run detail",
    selectRunStep: "Select a Run step to inspect what happened.",
    selectStep: "select a step",
    selectedStep: "Selected step",
    sourceNotFound: "source not found",
    status: "Status",
    traceOnly: "Prompt trace only. Not a lifecycle verdict.",
  },
} satisfies Record<PromptMapLanguage, Record<string, string>>;
