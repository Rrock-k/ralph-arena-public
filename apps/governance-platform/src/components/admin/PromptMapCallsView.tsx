"use client";

import { useEffect, useState } from "react";

import type { RalphPromptDefinition } from "@/lib/ralph-prompts";
import type {
  PromptTraceEvent,
  RalphPromptTraceMap,
} from "@/lib/ralph-prompt-traces";
import type { PromptMapLanguage } from "@/lib/ralph-prompt-map-projections";
import {
  formatPromptCallRowTooltip,
  formatPromptCallStatus,
  formatPromptCallStatusReason,
} from "@/lib/ralph-prompt-call-status";

export interface PromptCallSelection {
  projectId: string;
  eventId: string;
}

interface PromptMapCallsViewProps {
  traceMap: RalphPromptTraceMap;
  prompts: RalphPromptDefinition[];
  selectedEventId: string;
  onSelectCall: (selection: PromptCallSelection) => void;
  language: PromptMapLanguage;
}

type PromptCallRow = {
  run: RalphPromptTraceMap["runs"][number];
  event: PromptTraceEvent;
  promptDefinition: RalphPromptDefinition | null;
};

type CallTextPanelId = "prompt" | "output";

type CallTextPanel = {
  id: CallTextPanelId;
  label: string;
  chars: number;
  text: string;
  emptyText: string;
};

type CallInfoModal = {
  title: string;
  meta: string;
  body: string;
};

export function PromptMapCallsView({
  traceMap,
  prompts,
  selectedEventId,
  onSelectCall,
  language,
}: PromptMapCallsViewProps) {
  const copy = PROMPT_CALLS_COPY[language];
  const rows = buildPromptCallRows(traceMap, prompts);
  const selected = rows.find((row) => row.event.eventId === selectedEventId) ?? rows[0] ?? null;
  const [activeTextPanel, setActiveTextPanel] = useState<CallTextPanelId>("prompt");
  const [modal, setModal] = useState<CallInfoModal | null>(null);

  useEffect(() => {
    setActiveTextPanel("prompt");
    setModal(null);
  }, [selected?.event.eventId]);

  if (rows.length === 0) {
    return (
      <div className="empty">
        <strong>{copy.emptyTitle}</strong>
        <p>{copy.emptyText}</p>
      </div>
    );
  }

  return (
    <div className="promptCalls">
      <section className="panel callListPanel">
        <div className="previewHead">
          <span>{copy.listTitle}</span>
          <span>{rows.length} {copy.calls}</span>
        </div>
        <div className="callRows">
          {rows.map((row) => (
            <button
              className={`callRow ${selected?.event.eventId === row.event.eventId ? "active" : ""} ${getCallTone(row.event)}`}
              key={row.event.eventId}
              title={formatPromptCallRowTooltip(row.event, language)}
              type="button"
              onClick={() => onSelectCall({
                projectId: row.run.projectId,
                eventId: row.event.eventId,
              })}
            >
              <span>{formatCallTime(row.event.timestamp, language)}</span>
              <b>{row.event.promptId}</b>
              <small>{row.run.projectName}</small>
              <em title={formatPromptCallStatusReason(row.event, language)}>
                {formatPromptCallStatus(row.event, language)}
              </em>
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <section className="callDetailPanel">
          <div className="callHero">
            <span className="eyebrow">{copy.selectedCall}</span>
            <h2>{selected.event.label}</h2>
            <small>
              {selected.run.projectName} · {selected.event.promptId} · {formatCallTime(selected.event.timestamp, language)}
              {selected.event.model ? ` · ${selected.event.model}` : ""}
            </small>
          </div>

          <PromptTextAccordion
            activePanel={activeTextPanel}
            onPanelChange={setActiveTextPanel}
            panels={[
              {
                id: "prompt",
                label: "Prompt",
                chars: selected.event.prompt.charCount,
                text: selected.event.prompt.text,
                emptyText: copy.emptyPrompt,
              },
              {
                id: "output",
                label: "Output",
                chars: selected.event.output.charCount,
                text: selected.event.output.text,
                emptyText: copy.emptyOutput,
              },
            ]}
          />

          <button
            className={`systemRead ${getCallTone(selected.event)}`}
            title={copy.systemReadTooltip}
            type="button"
            onClick={() => setModal(getSystemReadModal(selected.event, language))}
          >
            <span>{copy.systemRead}</span>
            <b>{formatParseStatus(selected.event.parse.status, language)}</b>
            <small>{selected.event.parse.summary ?? copy.noDecisionSummary}</small>
          </button>

          <div className="callMetaLine">
            <button
              title={copy.sourceTooltip}
              type="button"
              onClick={() => setModal(getSourceModal(selected.promptDefinition, selected.event, language))}
            >
              {copy.source}: {selected.promptDefinition ? formatSource(selected.promptDefinition) : copy.sourceNotFound}
            </button>
            <button
              title={copy.statusTooltip}
              type="button"
              onClick={() => setModal(getStatusModal(selected.event, language))}
            >
              {copy.status}: {formatPromptCallStatus(selected.event, language)}
            </button>
          </div>
        </section>
      )}

      <div
        className={`modal ${modal ? "open" : ""}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setModal(null);
          }
        }}
      >
        <div className="modalBox">
          <div className="modalTop">
            <div>
              <strong>{modal?.title ?? ""}</strong>
              <span className="modalMeta">
                {modal ? ` · ${modal.meta}` : ""}
              </span>
            </div>
            <button
              className="close"
              type="button"
              onClick={() => setModal(null)}
            >
              {copy.close}
            </button>
          </div>
          <div className="modalBody">
            <pre>{modal?.body ?? ""}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function PromptTextAccordion({
  activePanel,
  onPanelChange,
  panels,
}: {
  activePanel: CallTextPanelId;
  onPanelChange: (panel: CallTextPanelId) => void;
  panels: CallTextPanel[];
}) {
  return (
    <div className="promptOutputGrid">
      {panels.map((panel) => {
        const isActive = panel.id === activePanel;

        return (
          <section className={`callTextPanel ${isActive ? "active" : ""}`} key={panel.id}>
            <button
              aria-expanded={isActive}
              className="previewHead callTextTrigger"
              type="button"
              onClick={() => onPanelChange(panel.id)}
            >
              <span>{panel.label}</span>
              <span>{panel.chars} chars</span>
            </button>
            {isActive && <pre>{panel.text.trim() || panel.emptyText}</pre>}
          </section>
        );
      })}
    </div>
  );
}

function buildPromptCallRows(
  traceMap: RalphPromptTraceMap,
  prompts: RalphPromptDefinition[],
): PromptCallRow[] {
  const promptsById = new Map(prompts.map((prompt) => [prompt.id, prompt]));

  return traceMap.runs
    .flatMap((run) =>
      run.events.map((event) => ({
        run,
        event,
        promptDefinition: promptsById.get(event.promptId) ?? null,
      })),
    )
    .sort((left, right) => right.event.timestamp.localeCompare(left.event.timestamp));
}

function formatSource(prompt: RalphPromptDefinition) {
  return `${prompt.source.file} · ${prompt.source.symbol}${
    prompt.source.lineHint ? `:${prompt.source.lineHint}` : ""
  }`;
}

function formatParseStatus(status: PromptTraceEvent["parse"]["status"], language: PromptMapLanguage) {
  if (language === "ru") {
    if (status === "ok") return "decision записан";
    if (status === "error") return "decision не прочитан";
    return "decision не записан";
  }

  if (status === "ok") return "decision recorded";
  if (status === "error") return "decision unreadable";
  return "decision not recorded";
}

function getCallTone(event: PromptTraceEvent) {
  if (!event.success || event.parse.status === "error") return "warn";
  if (event.parse.status === "not_recorded") return "info";
  return "ok";
}

function getSystemReadModal(
  event: PromptTraceEvent,
  language: PromptMapLanguage,
): CallInfoModal {
  const parseStatus = formatParseStatus(event.parse.status, language);

  if (language === "en") {
    return {
      title: "System read",
      meta: `${event.promptId} · ${parseStatus}`,
      body: [
        "In short",
        "This is Ralph's compact readout of the model output.",
        "",
        `Now: ${parseStatus}.`,
        event.parse.summary
          ? `Summary: ${event.parse.summary}`
          : "Summary: not recorded for this call.",
        "",
        "How to use it",
        "- Use Prompt when you want to inspect what the model received.",
        "- Use Output when you want to inspect the raw model answer.",
        "- Use System read when you want the shortest interpretation of that answer.",
        "",
        "This is not a project status. It only describes this one model call.",
      ].join("\n"),
    };
  }

  return {
    title: "Система поняла",
    meta: `${event.promptId} · ${parseStatus}`,
    body: [
      "Коротко",
      "Это короткая интерпретация ответа модели со стороны Ralph.",
      "",
      `Сейчас: ${parseStatus}.`,
      event.parse.summary
        ? `Вывод: ${event.parse.summary}`
        : "Вывод: для этого call краткий вывод не записан.",
      "",
      "Как пользоваться",
      "- Prompt показывает, что модель получила на вход.",
      "- Output показывает сырой ответ модели.",
      "- Система поняла показывает самый короткий смысл этого ответа.",
      "",
      "Это не статус проекта. Это объяснение одного model call.",
    ].join("\n"),
  };
}

function getSourceModal(
  promptDefinition: RalphPromptDefinition | null,
  event: PromptTraceEvent,
  language: PromptMapLanguage,
): CallInfoModal {
  const source = promptDefinition ? formatSource(promptDefinition) : PROMPT_CALLS_COPY[language].sourceNotFound;

  if (language === "en") {
    return {
      title: "Source",
      meta: event.promptId,
      body: [
        "In short",
        "Source points to the Prompt Repository definition for this prompt.",
        "",
        `Current source: ${source}.`,
        "",
        "How to use it",
        "- Use this when you need to find the code/repository definition that produced this prompt family.",
        "- It is not the exact rendered prompt. The exact rendered text is the Prompt panel above.",
      ].join("\n"),
    };
  }

  return {
    title: "Source",
    meta: event.promptId,
    body: [
      "Коротко",
      "Source показывает определение Prompt Repository для этого prompt.",
      "",
      `Текущий source: ${source}.`,
      "",
      "Как пользоваться",
      "- Используй это, когда нужно найти код/определение, из которого пришёл этот prompt family.",
      "- Это не точный rendered prompt. Точный отправленный текст находится выше в панели Prompt.",
    ].join("\n"),
  };
}

function getStatusModal(
  event: PromptTraceEvent,
  language: PromptMapLanguage,
): CallInfoModal {
  const status = formatPromptCallStatus(event, language);
  const reason = formatPromptCallStatusReason(event, language);

  if (language === "en") {
    return {
      title: "Status",
      meta: `${event.promptId} · ${status}`,
      body: [
        "In short",
        "Status describes this recorded model call only.",
        "",
        `Current status: ${status}.`,
        `Reason: ${reason}.`,
        "",
        "How to read it",
        "- ok: the call was recorded successfully.",
        "- unreadable: the call happened, but Ralph could not parse the expected structured readout.",
        "- failed: the call itself failed.",
        "",
        "This is call evidence, not a project lifecycle verdict.",
      ].join("\n"),
    };
  }

  return {
    title: "Status",
    meta: `${event.promptId} · ${status}`,
    body: [
      "Коротко",
      "Status описывает только этот записанный model call.",
      "",
      `Текущий статус: ${status}.`,
      `Причина: ${reason}.`,
      "",
      "Как читать",
      "- ok: call успешно записан.",
      "- unreadable: call был, но Ralph не смог прочитать ожидаемый structured readout.",
      "- failed: сам call упал.",
      "",
      "Это evidence по вызову, а не lifecycle verdict проекта.",
    ].join("\n"),
  };
}

function formatCallTime(value: string, language: PromptMapLanguage) {
  try {
    return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en", {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

const PROMPT_CALLS_COPY = {
  ru: {
    calls: "вызовов",
    close: "закрыть",
    emptyOutput: "Output пустой.",
    emptyPrompt: "Prompt пустой.",
    emptyText: "Когда Ralph выполнит model calls, они появятся здесь как простой список Prompt -> Output.",
    emptyTitle: "Prompt calls пока нет.",
    listTitle: "Prompt calls",
    noDecisionSummary: "Система не записала краткий вывод по этому call.",
    selectedCall: "Selected prompt call",
    source: "source",
    sourceNotFound: "source not found",
    sourceTooltip: "Где определён этот prompt family.",
    status: "status",
    statusTooltip: "Что значит статус этого model call.",
    systemRead: "Система поняла",
    systemReadTooltip: "Как Ralph кратко понял ответ модели.",
  },
  en: {
    calls: "calls",
    close: "close",
    emptyOutput: "Output is empty.",
    emptyPrompt: "Prompt is empty.",
    emptyText: "When Ralph records model calls, they will appear here as a simple Prompt -> Output list.",
    emptyTitle: "No prompt calls yet.",
    listTitle: "Prompt calls",
    noDecisionSummary: "The system did not record a short readout for this call.",
    selectedCall: "Selected prompt call",
    source: "source",
    sourceNotFound: "source not found",
    sourceTooltip: "Where this prompt family is defined.",
    status: "status",
    statusTooltip: "What this model-call status means.",
    systemRead: "System read",
    systemReadTooltip: "How Ralph briefly interpreted the model output.",
  },
} satisfies Record<PromptMapLanguage, Record<string, string>>;
