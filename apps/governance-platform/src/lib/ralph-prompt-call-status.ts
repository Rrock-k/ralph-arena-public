import type { PromptMapLanguage } from "@/lib/ralph-prompt-map-projections";
import type { PromptTraceEvent } from "@/lib/ralph-prompt-traces";

const PROMPT_CALL_STATUS_COPY = {
  ru: {
    failed: "failed",
    ok: "ok",
    unreadable: "unreadable",
    click: "Клик: Prompt, Output и System read.",
    reason: "Причина",
    scope: "Это evidence одного model call, не lifecycle verdict проекта.",
    noDecisionSummary: "decision summary не записан",
    notRecorded: "system decision не записан",
    taskCompleteButFailed: "output содержит TASK_COMPLETE, но provider/agent result записал failure",
    providerError: "provider error",
    providerApiError: "provider API error",
    rateLimitRejected: "provider rate limit rejected",
    unknownFailure: "call failed; точная причина не записана в trace",
  },
  en: {
    failed: "failed",
    ok: "ok",
    unreadable: "unreadable",
    click: "Click: Prompt, Output and System read.",
    reason: "Reason",
    scope: "This is one model-call evidence item, not a project lifecycle verdict.",
    noDecisionSummary: "decision summary not recorded",
    notRecorded: "system decision not recorded",
    taskCompleteButFailed: "output contains TASK_COMPLETE, but provider/agent result recorded failure",
    providerError: "provider error",
    providerApiError: "provider API error",
    rateLimitRejected: "provider rate limit rejected",
    unknownFailure: "call failed; exact reason was not recorded in trace",
  },
} satisfies Record<PromptMapLanguage, Record<string, string>>;

export function formatPromptCallStatus(
  event: PromptTraceEvent,
  language: PromptMapLanguage,
) {
  const copy = PROMPT_CALL_STATUS_COPY[language];

  if (!event.success) return copy.failed;
  if (event.parse.status === "error") return copy.unreadable;
  return copy.ok;
}

export function formatPromptCallStatusReason(
  event: PromptTraceEvent,
  language: PromptMapLanguage,
) {
  const copy = PROMPT_CALL_STATUS_COPY[language];

  if (!event.success) {
    return extractFailureReason(event.output.text, language)
      ?? (event.context.completionPromiseFound === true ? copy.taskCompleteButFailed : null)
      ?? event.parse.summary
      ?? copy.unknownFailure;
  }

  if (event.parse.status === "error") {
    return event.parse.summary ?? copy.noDecisionSummary;
  }

  if (event.parse.status === "not_recorded") {
    return copy.notRecorded;
  }

  return event.parse.summary ?? copy.noDecisionSummary;
}

export function formatPromptCallRowTooltip(
  event: PromptTraceEvent,
  language: PromptMapLanguage,
) {
  const copy = PROMPT_CALL_STATUS_COPY[language];
  const status = formatPromptCallStatus(event, language);
  const reason = formatPromptCallStatusReason(event, language);

  return [
    `${event.promptId} · ${status}`,
    `${copy.reason}: ${reason}`,
    copy.scope,
    copy.click,
  ].join("\n");
}

function extractFailureReason(output: string, language: PromptMapLanguage) {
  const copy = PROMPT_CALL_STATUS_COPY[language];
  const compactOutput = output.replace(/\s+/g, " ");

  const sessionLimit = compactOutput.match(/You've hit your (?:session )?limit\s*[·-]\s*resets [^"'}]+/i);
  if (sessionLimit?.[0]) return trimReason(sessionLimit[0]);

  const timeout = compactOutput.match(/Agent timed out after \d+ minutes/i);
  if (timeout?.[0]) return timeout[0];

  const providerError = compactOutput.match(/"error"\s*:\s*"([^"]+)"/i);
  if (providerError?.[1]) return `${copy.providerError}: ${providerError[1]}`;

  const apiStatus = compactOutput.match(/"api_error_status"\s*:\s*(\d+)/i);
  if (apiStatus?.[1]) return `${copy.providerApiError}: ${apiStatus[1]}`;

  if (/"type"\s*:\s*"rate_limit_event"/i.test(compactOutput) && /"status"\s*:\s*"rejected"/i.test(compactOutput)) {
    return copy.rateLimitRejected;
  }

  const exitCode = compactOutput.match(/Claude exited with code \d+/i);
  if (exitCode?.[0]) return exitCode[0];

  return null;
}

function trimReason(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}
