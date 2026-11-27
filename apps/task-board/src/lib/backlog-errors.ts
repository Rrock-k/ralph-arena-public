import { DuplicateTaskIdError, InvalidTaskStatusError } from "./parser";

export type BacklogErrorKind = "DUPLICATE_TASK_ID" | "INVALID_TASK_STATUS" | "BACKLOG_READ_FAILED";

export interface BacklogUiError {
  kind: BacklogErrorKind;
  title: string;
  summary: string;
  details: string[];
  rawMessage: string;
  sourceFile?: string;
}

export interface BacklogErrorResponse {
  type: BacklogErrorKind;
  title: string;
  error: string;
  details: string[];
  rawMessage: string;
  sourceFile?: string;
}

const SOURCE_FILE_RE = / in ([^,]+\.md)$/;

function extractSourceFile(details: string[]): string | undefined {
  for (const detail of details) {
    const match = detail.match(SOURCE_FILE_RE);
    if (match) return match[1];
  }
  return undefined;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function normalizeBacklogError(error: unknown, sourceFile?: string): BacklogUiError {
  if (error instanceof DuplicateTaskIdError) {
    const effectiveSourceFile = sourceFile || extractSourceFile(error.duplicateIds);
    return {
      kind: "DUPLICATE_TASK_ID",
      title: "Ошибка структуры backlog",
      summary: effectiveSourceFile
        ? `В \`${effectiveSourceFile}\` есть дублирующиеся ID задач.`
        : "В backlog есть дублирующиеся ID задач.",
      details: error.duplicateIds,
      rawMessage: error.message,
      sourceFile: effectiveSourceFile,
    };
  }

  if (error instanceof InvalidTaskStatusError) {
    const effectiveSourceFile = sourceFile || error.sourceFile;
    return {
      kind: "INVALID_TASK_STATUS",
      title: "Ошибка структуры backlog",
      summary: `В \`${effectiveSourceFile}\` есть задачи с неподдерживаемым статусом.`,
      details: error.invalidStatuses,
      rawMessage: error.message,
      sourceFile: effectiveSourceFile,
    };
  }

  if (isErrnoException(error) && error.code === "ENOENT") {
    const effectiveSourceFile = sourceFile;
    const rawMessage = error.message || "Requested backlog file was not found";
    return {
      kind: "BACKLOG_READ_FAILED",
      title: "Файл backlog не найден",
      summary: effectiveSourceFile
        ? `Не удалось найти \`${effectiveSourceFile}\`.`
        : "Не удалось найти нужный backlog-файл.",
      details: [rawMessage],
      rawMessage,
      sourceFile: effectiveSourceFile,
    };
  }

  const rawMessage = error instanceof Error
    ? error.message
    : "Unknown backlog loading error";

  return {
    kind: "BACKLOG_READ_FAILED",
    title: "Ошибка чтения backlog",
    summary: sourceFile
      ? `Не удалось прочитать \`${sourceFile}\`.`
      : "Task board не смог прочитать backlog.",
    details: rawMessage ? [rawMessage] : [],
    rawMessage,
    sourceFile,
  };
}

export function toBacklogErrorResponse(error: BacklogUiError): BacklogErrorResponse {
  return {
    type: error.kind,
    title: error.title,
    error: error.summary,
    details: error.details,
    rawMessage: error.rawMessage,
    ...(error.sourceFile ? { sourceFile: error.sourceFile } : {}),
  };
}

export function getBacklogErrorStatus(error: BacklogUiError): number {
  return error.kind === "DUPLICATE_TASK_ID" || error.kind === "INVALID_TASK_STATUS" ? 422 : 500;
}

export function parseBacklogErrorPayload(payload: unknown): BacklogUiError | null {
  if (!payload || typeof payload !== "object") return null;

  const candidate = payload as Record<string, unknown>;
  const kind: BacklogErrorKind = candidate.type === "DUPLICATE_TASK_ID"
    ? "DUPLICATE_TASK_ID"
    : candidate.type === "INVALID_TASK_STATUS"
      ? "INVALID_TASK_STATUS"
      : "BACKLOG_READ_FAILED";
  const title = typeof candidate.title === "string" ? candidate.title : null;
  const summary = typeof candidate.error === "string" ? candidate.error : null;
  const rawMessage = typeof candidate.rawMessage === "string"
    ? candidate.rawMessage
    : summary;

  if (!title || !summary || !rawMessage) return null;

  return {
    kind,
    title,
    summary,
    details: Array.isArray(candidate.details)
      ? candidate.details.filter((item): item is string => typeof item === "string")
      : [],
    rawMessage,
    sourceFile: typeof candidate.sourceFile === "string" ? candidate.sourceFile : undefined,
  };
}
