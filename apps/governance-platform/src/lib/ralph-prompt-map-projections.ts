import type { RalphPromptDefinition } from "./ralph-prompts";
import type {
  PromptTraceEvent,
  RalphPromptTraceMap,
  RalphPromptTraceRun,
} from "./ralph-prompt-traces";

export type PromptMapProjectionTone = "ok" | "warn" | "info";
export type PromptMapLanguage = "ru" | "en";

export interface PromptUsageSummary {
  callCount: number;
  failedCount: number;
  lastAt: string | null;
  lastRunName: string | null;
}

export interface PromptAttentionItem {
  id: string;
  label: string;
  value: string;
  detail: string;
  projectId: string;
  eventId?: string;
}

type PromptAttentionBuildItem = PromptAttentionItem & {
  occurredAt: string | null;
  order: number;
};

export interface ObservedRunMetric {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: PromptMapProjectionTone;
}

export interface ObservedRunSummary {
  tone: PromptMapProjectionTone;
  headline: string;
  detail: string;
  metrics: ObservedRunMetric[];
  nextIssue: PromptAttentionItem | null;
}

export interface PromptRunTimelineItem {
  id: string;
  eventId: string;
  stepLabel: string;
  title: string;
  meta: string;
  detail: string;
  tone: PromptMapProjectionTone;
}

const ATTENTION_ORDER = {
  failedCall: 0,
  decisionUnclear: 1,
  decisionMissing: 2,
  sourceMissing: 3,
  runStoryIncomplete: 4,
} as const;

export function buildPromptUsageById(traceMap: RalphPromptTraceMap) {
  const usageById = new Map<string, PromptUsageSummary>();

  for (const run of traceMap.runs) {
    for (const event of run.events) {
      const current = usageById.get(event.promptId) ?? {
        callCount: 0,
        failedCount: 0,
        lastAt: null,
        lastRunName: null,
      };
      const isLatest = !current.lastAt || event.timestamp > current.lastAt;

      usageById.set(event.promptId, {
        callCount: current.callCount + 1,
        failedCount: current.failedCount + (event.success ? 0 : 1),
        lastAt: isLatest ? event.timestamp : current.lastAt,
        lastRunName: isLatest ? run.projectName : current.lastRunName,
      });
    }
  }

  return usageById;
}

export function buildPromptAttentionItems(
  traceMap: RalphPromptTraceMap,
  prompts: RalphPromptDefinition[],
  language: PromptMapLanguage = "en",
) {
  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  const items: PromptAttentionBuildItem[] = [];
  const copy = PROJECTION_COPY[language];

  for (const run of traceMap.runs) {
    run.errors.forEach((error, index) => {
      items.push({
        id: `${run.projectId}:trace-file:${index}`,
        label: copy.attention.runStoryIncomplete,
        value: run.projectName,
        detail: truncateText(error, 180),
        projectId: run.projectId,
        occurredAt: run.latestAt,
        order: ATTENTION_ORDER.runStoryIncomplete,
      });
    });

    for (const event of run.events) {
      if (!event.success) {
        items.push({
          id: `${event.eventId}:failed-call`,
          label: copy.attention.modelCallFailed,
          value: event.label,
          detail: `${run.projectName} · ${event.owner} · ${event.promptId}`,
          projectId: run.projectId,
          eventId: event.eventId,
          occurredAt: event.timestamp,
          order: ATTENTION_ORDER.failedCall,
        });
      }

      if (event.parse.status === "error") {
        items.push({
          id: `${event.eventId}:decision-unreadable`,
          label: copy.attention.decisionUnclear,
          value: event.label,
          detail: event.parse.summary
            ? `${run.projectName} · ${event.parse.summary}`
            : `${run.projectName} · ${copy.details.decisionUnreadable}`,
          projectId: run.projectId,
          eventId: event.eventId,
          occurredAt: event.timestamp,
          order: ATTENTION_ORDER.decisionUnclear,
        });
      }

      if (event.parse.status === "not_recorded") {
        items.push({
          id: `${event.eventId}:decision-missing`,
          label: copy.attention.noSystemDecision,
          value: event.label,
          detail: `${run.projectName} · ${copy.details.decisionMissing}`,
          projectId: run.projectId,
          eventId: event.eventId,
          occurredAt: event.timestamp,
          order: ATTENTION_ORDER.decisionMissing,
        });
      }

      if (!promptIds.has(event.promptId)) {
        items.push({
          id: `${event.eventId}:source-missing`,
          label: copy.attention.promptSourceMissing,
          value: event.promptId,
          detail: `${run.projectName} · ${copy.details.promptSourceMissing}`,
          projectId: run.projectId,
          eventId: event.eventId,
          occurredAt: event.timestamp,
          order: ATTENTION_ORDER.sourceMissing,
        });
      }
    }
  }

  return items
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return compareNullableIsoDesc(left.occurredAt, right.occurredAt);
    })
    .map(({ occurredAt: _occurredAt, order: _order, ...item }) => item);
}

export function buildObservedRunSummary(
  run: RalphPromptTraceRun | null,
  prompts: RalphPromptDefinition[],
  attentionItems: PromptAttentionItem[],
  language: PromptMapLanguage = "en",
): ObservedRunSummary {
  const copy = PROJECTION_COPY[language];

  if (!run) {
    return {
      tone: "info",
      headline: copy.summary.noRun,
      detail: copy.details.selectRun,
      metrics: [],
      nextIssue: null,
    };
  }

  const promptIds = new Set(prompts.map((prompt) => prompt.id));
  const failedCount = run.events.filter((event) => !event.success).length;
  const decisionErrorCount = run.events.filter(
    (event) => event.parse.status === "error",
  ).length;
  const missingDecisionCount = run.events.filter(
    (event) => event.parse.status === "not_recorded",
  ).length;
  const unlinkedSourceCount = run.events.filter(
    (event) => !promptIds.has(event.promptId),
  ).length;
  const parsedDecisionCount = run.events.filter(
    (event) => event.parse.status === "ok",
  ).length;
  const hasHardIssue =
    failedCount > 0 ||
    decisionErrorCount > 0 ||
    unlinkedSourceCount > 0 ||
    run.errors.length > 0;
  const hasIncompleteTrace = missingDecisionCount > 0 || run.events.length === 0;
  const tone: PromptMapProjectionTone = hasHardIssue
    ? "warn"
    : hasIncompleteTrace
      ? "info"
      : "ok";

  return {
    tone,
    headline: formatObservedRunHeadline(tone, language),
    detail: `${run.projectName} · ${formatRecordedCalls(run.events.length, language)} · ${formatLatestTraceCopy(run.latestAt, language)}`,
    nextIssue: attentionItems.find((item) => item.projectId === run.projectId) ?? null,
    metrics: [
      {
        id: "calls",
        label: copy.metrics.calls,
        value: run.events.length > 0 ? `${run.events.length}` : copy.values.none,
        detail:
          run.events.length > 0
            ? copy.details.callsRecorded
            : copy.details.callsMissing,
        tone: run.events.length > 0 ? "ok" : "info",
      },
      {
        id: "failures",
        label: copy.metrics.failures,
        value: failedCount > 0 ? `${failedCount}` : copy.values.none,
        detail:
          failedCount > 0
            ? copy.details.failuresPresent
            : copy.details.failuresMissing,
        tone: failedCount > 0 ? "warn" : "ok",
      },
      {
        id: "decisions",
        label: copy.metrics.decisions,
        value:
          decisionErrorCount > 0
            ? `${decisionErrorCount} ${copy.values.unclear}`
            : missingDecisionCount > 0
              ? `${missingDecisionCount} ${copy.values.missing}`
              : `${parsedDecisionCount}`,
        detail:
          decisionErrorCount > 0
            ? copy.details.decisionsUnclear
            : missingDecisionCount > 0
              ? copy.details.decisionsMissing
              : copy.details.decisionsRecorded,
        tone: decisionErrorCount > 0 ? "warn" : missingDecisionCount > 0 ? "info" : "ok",
      },
      {
        id: "sources",
        label: copy.metrics.sources,
        value: unlinkedSourceCount > 0 ? `${unlinkedSourceCount} ${copy.values.missing}` : copy.values.linked,
        detail:
          unlinkedSourceCount > 0
            ? copy.details.sourcesMissing
            : copy.details.sourcesLinked,
        tone: unlinkedSourceCount > 0 ? "warn" : "ok",
      },
      {
        id: "trace-file",
        label: copy.metrics.traceFile,
        value: run.errors.length > 0 ? `${run.errors.length} ${copy.values.issues}` : copy.values.clean,
        detail:
          run.errors.length > 0
            ? copy.details.traceIssues
            : copy.details.traceClean,
        tone: run.errors.length > 0 ? "warn" : "ok",
      },
    ],
  };
}

export function buildPromptRunTimelineItems(
  run: RalphPromptTraceRun | null,
  language: PromptMapLanguage = "en",
): PromptRunTimelineItem[] {
  if (!run) return [];

  return run.events.map((event, index) => ({
    id: event.eventId,
    eventId: event.eventId,
    stepLabel: `${PROJECTION_COPY[language].values.step} ${String(index + 1).padStart(2, "0")}`,
    title: event.label,
    meta: `${event.owner} · ${event.promptId}`,
    detail: formatRunStoryDetail(event, language),
    tone: getRunStoryTone(event),
  }));
}

export function formatPromptUsageBadge(
  usage: PromptUsageSummary | undefined,
  language: PromptMapLanguage = "en",
) {
  const copy = PROJECTION_COPY[language];

  if (!usage) return copy.usage.notSeen;
  if (usage.failedCount > 0) return `${copy.usage.failed} ${usage.failedCount}`;
  return `${copy.usage.seen} ${usage.callCount}`;
}

export function formatPromptUsageDetail(
  usage: PromptUsageSummary | undefined,
  language: PromptMapLanguage = "en",
) {
  const copy = PROJECTION_COPY[language];

  if (!usage) {
    return copy.usage.notSeenDetail;
  }

  const callLabel = formatCallWord(usage.callCount, language);
  const failures = usage.failedCount > 0 ? `, ${usage.failedCount} ${copy.usage.failed}` : "";
  const lastSeen = usage.lastAt
    ? ` ${copy.usage.lastSeen} ${usage.lastRunName ?? copy.values.unknownRun}: ${formatTraceTime(usage.lastAt, language)}.`
    : "";

  return `${usage.callCount} ${callLabel}${failures}.${lastSeen}`;
}

function formatTraceTime(value: string, language: PromptMapLanguage) {
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

function compareNullableIsoDesc(left: string | null, right: string | null) {
  if (left && right) return right.localeCompare(left);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function formatObservedRunHeadline(
  tone: PromptMapProjectionTone,
  language: PromptMapLanguage,
) {
  const copy = PROJECTION_COPY[language].summary;

  if (tone === "warn") return copy.needsReview;
  if (tone === "info") return copy.incomplete;
  return copy.noIssues;
}

function formatLatestTraceCopy(value: string | null, language: PromptMapLanguage) {
  const copy = PROJECTION_COPY[language].values;

  return value ? `${copy.latest} ${formatTraceTime(value, language)}` : copy.noEventTime;
}

function getRunStoryTone(event: PromptTraceEvent): PromptMapProjectionTone {
  if (!event.success || event.parse.status === "error") return "warn";
  if (event.parse.status === "not_recorded") return "info";
  return "ok";
}

function formatRunStoryDetail(
  event: PromptTraceEvent,
  language: PromptMapLanguage,
) {
  const copy = PROJECTION_COPY[language].details;

  if (!event.success) {
    return event.output.text
      ? `${copy.failed} · ${truncateText(event.output.text, 120)}`
      : copy.failedBeforeResponse;
  }

  if (event.parse.status === "error") {
    return event.parse.summary
      ? `${copy.decisionUnreadableTitle} · ${event.parse.summary}`
      : copy.decisionUnreadableTitle;
  }

  if (event.parse.status === "not_recorded") {
    return copy.answerWithoutDecision;
  }

  return event.parse.summary
    ? `${copy.systemChose} · ${event.parse.summary}`
    : copy.parsedDecisionRecorded;
}

function truncateText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "empty detail";
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function formatRecordedCalls(count: number, language: PromptMapLanguage) {
  return `${count} ${formatCallWord(count, language)}`;
}

function formatCallWord(count: number, language: PromptMapLanguage) {
  if (language === "ru") {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) return "записанный вызов";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "записанных вызова";
    return "записанных вызовов";
  }

  return count === 1 ? "recorded call" : "recorded calls";
}

const PROJECTION_COPY = {
  ru: {
    attention: {
      runStoryIncomplete: "Run story неполная",
      modelCallFailed: "Model call failed",
      decisionUnclear: "Decision unclear",
      noSystemDecision: "Нет system decision",
      promptSourceMissing: "Prompt source missing",
    },
    details: {
      answerWithoutDecision: "Модель ответила · parsed decision не записан",
      callsMissing: "В этом Run не записано ни одного prompt call.",
      callsRecorded: "Model calls записаны в этом Run.",
      decisionMissing: "детали решения не записаны",
      decisionUnreadable: "системное решение не удалось прочитать",
      decisionUnreadableTitle: "Решение не прочитано",
      decisionsMissing: "Хотя бы один ответ модели не имеет parsed decision summary.",
      decisionsRecorded: "Parsed decision summaries записаны.",
      decisionsUnclear: "Хотя бы одно системное решение не удалось распарсить.",
      failed: "Failed",
      failedBeforeResponse: "Ошибка до записи ответа модели",
      failuresMissing: "Падений prompt calls не записано.",
      failuresPresent: "Хотя бы один prompt call завершился ошибкой.",
      parsedDecisionRecorded: "Parsed decision записан",
      promptSourceMissing: "observed prompt отсутствует в Prompt Repository",
      selectRun: "Выбери run, чтобы посмотреть записанные prompt calls.",
      sourcesLinked: "Observed prompt calls связаны с Prompt Repository.",
      sourcesMissing: "Observed prompt ids отсутствуют в Prompt Repository.",
      systemChose: "Система выбрала",
      traceClean: "Trace evidence распарсился без ошибок.",
      traceIssues: "В run evidence найдены битые trace lines.",
    },
    metrics: {
      calls: "Prompt calls",
      decisions: "Parsed decisions",
      failures: "Ошибки",
      sources: "Источники prompt",
      traceFile: "Trace file",
    },
    summary: {
      incomplete: "Trace неполный",
      needsReview: "Нужно проверить",
      noIssues: "Проблем не записано",
      noRun: "Run не выбран",
    },
    usage: {
      failed: "ошибок",
      lastSeen: "Последний раз",
      notSeen: "ещё не видели",
      notSeenDetail: "В записанных runs пока не встречался. Это не доказывает, что prompt не используется.",
      seen: "видели",
    },
    values: {
      clean: "чисто",
      issues: "ошибок",
      latest: "последнее",
      linked: "связаны",
      missing: "нет",
      noEventTime: "нет времени events",
      none: "нет",
      step: "Шаг",
      unclear: "неясно",
      unknownRun: "неизвестный run",
    },
  },
  en: {
    attention: {
      runStoryIncomplete: "Run story incomplete",
      modelCallFailed: "Model call failed",
      decisionUnclear: "Decision unclear",
      noSystemDecision: "No system decision",
      promptSourceMissing: "Prompt source missing",
    },
    details: {
      answerWithoutDecision: "Model answered · no parsed decision recorded",
      callsMissing: "No prompt calls were recorded for this run.",
      callsRecorded: "Recorded model calls in this run.",
      decisionMissing: "decision details were not recorded",
      decisionUnreadable: "system decision could not be read",
      decisionUnreadableTitle: "Decision unreadable",
      decisionsMissing: "At least one model answer has no parsed decision summary.",
      decisionsRecorded: "Parsed decision summaries are recorded.",
      decisionsUnclear: "At least one system decision could not be parsed.",
      failed: "Failed",
      failedBeforeResponse: "Failed before model response was recorded",
      failuresMissing: "No failed prompt calls are recorded.",
      failuresPresent: "At least one prompt call failed.",
      parsedDecisionRecorded: "Parsed decision recorded",
      promptSourceMissing: "observed prompt is not in the Prompt Repository",
      selectRun: "Select an observed run to inspect recorded prompt calls.",
      sourcesLinked: "Observed prompt calls link to Prompt Repository entries.",
      sourcesMissing: "Observed prompt ids are missing from the Prompt Repository.",
      systemChose: "System chose",
      traceClean: "Trace evidence parsed cleanly.",
      traceIssues: "Malformed trace lines were found in this run evidence.",
    },
    metrics: {
      calls: "Prompt calls",
      decisions: "Parsed decisions",
      failures: "Failures",
      sources: "Prompt sources",
      traceFile: "Trace file",
    },
    summary: {
      incomplete: "Recorded trace is incomplete",
      needsReview: "Needs review",
      noIssues: "No recorded prompt issues",
      noRun: "No observed run selected",
    },
    usage: {
      failed: "failed",
      lastSeen: "Last seen in",
      notSeen: "not seen yet",
      notSeenDetail: "Not seen in recorded runs yet. This does not prove the prompt is unused.",
      seen: "seen",
    },
    values: {
      clean: "clean",
      issues: "issues",
      latest: "latest",
      linked: "linked",
      missing: "missing",
      noEventTime: "no event time",
      none: "none",
      step: "Step",
      unclear: "unclear",
      unknownRun: "unknown run",
    },
  },
} as const;
