export function getCommandPlaceholders(command: string): string[] {
  return Array.from(new Set(command.match(/<[^>\n]+>/g) ?? []));
}

function getRequiredCommandPlaceholders(command: string): string[] {
  return getCommandPlaceholders(command.replaceAll(/\s*\[[^\]\n]*<[^>\n]+>[^\]\n]*\]/g, ""));
}

export function formatCommandPlaceholderLabel(placeholder: string): string {
  return placeholder
    .replace(/^<|>$/g, "")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replaceAll("|", " / ");
}

export function getCommandPlaceholderCompletion(
  command: string,
  values: Record<string, string>,
): { filled: string[]; missing: string[] } {
  const placeholders = getCommandPlaceholders(command);
  const requiredPlaceholders = new Set(getRequiredCommandPlaceholders(command));
  return {
    filled: placeholders.filter((placeholder) => Boolean(values[placeholder]?.trim())),
    missing: placeholders.filter((placeholder) =>
      requiredPlaceholders.has(placeholder) && !values[placeholder]?.trim(),
    ),
  };
}

export function shellQuoteCommandValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(trimmed)) return trimmed;
  return `'${trimmed.replaceAll("'", "'\\''")}'`;
}

export function applyCommandPlaceholderValues(command: string, values: Record<string, string>): string {
  const commandWithOptionalSegments = command.replaceAll(/\s*\[([^\]\n]*<[^>\n]+>[^\]\n]*)\]/g, (_match, segment) => {
    const placeholders = getCommandPlaceholders(segment);
    if (!placeholders.every((placeholder) => Boolean(values[placeholder]?.trim()))) return "";
    return ` ${applyRequiredCommandPlaceholderValues(segment, values)}`;
  }).replaceAll(/\s*\[([^\]\n<>]+)\]/g, (_match, segment) => {
    const trimmed = String(segment).trim();
    return trimmed ? ` ${trimmed}` : "";
  });
  return applyRequiredCommandPlaceholderValues(commandWithOptionalSegments, values);
}

function applyRequiredCommandPlaceholderValues(command: string, values: Record<string, string>): string {
  return getCommandPlaceholders(command).reduce((current, placeholder) => {
    const replacement = shellQuoteCommandValue(values[placeholder] ?? "");
    return replacement ? current.replaceAll(placeholder, replacement) : current;
  }, command);
}

export function getSnapshotCommandInputHints(snapshot: unknown): Record<string, string> {
  const sourceRef = readNestedString(snapshot, ["source", "workspace", "commitSha"]);
  const workspacePath = readNestedString(snapshot, ["source", "workspace", "path"]);
  const specFile = readNestedString(snapshot, ["plan", "specFile"]);
  const selectedTaskId = readNestedString(snapshot, ["selectedTaskId"]);
  const executorMode = readSnapshotExecutorMode(snapshot, selectedTaskId);
  return {
    ...(workspacePath ? {
      "<project-source-workspace>": workspacePath,
      "<project-workdir>": workspacePath,
      "<snapshot-workspace>": workspacePath,
      "<ralph.config.json>": `${workspacePath}/.arena/ralph.config.json`,
      "<workspace/.arena/progress.json>": `${workspacePath}/.arena/progress.json`,
      "<project-workdir/.arena/progress.json>": `${workspacePath}/.arena/progress.json`,
    } : {}),
    ...(sourceRef ? {
      "<snapshot-git-commit>": sourceRef,
      "<executor-before-git-commit>": sourceRef,
      "<git-commit>": sourceRef,
    } : {}),
    ...(specFile ? { "<workDir-relative-spec>": specFile } : {}),
    ...(selectedTaskId ? { "<taskId>": selectedTaskId, "<task-id>": selectedTaskId } : {}),
    ...(executorMode ? { "<new_task|failed_task|resume_interrupted>": executorMode } : {}),
  };
}

function readSnapshotExecutorMode(snapshot: unknown, selectedTaskId: string | null): string | null {
  if (!selectedTaskId) return null;
  const canPrepareExecutor = readNestedBoolean(snapshot, [
    "providerSessions",
    "selectedTaskCheckpointReadback",
    "canPrepareExecutor",
  ]);
  const mode = readExecutorMode(readNestedValue(snapshot, [
    "providerSessions",
    "selectedTaskCheckpointReadback",
    "recommendedExecutorMode",
  ]));
  return canPrepareExecutor === true ? mode : null;
}

function readNestedString(value: unknown, path: string[]): string | null {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current : null;
}

function readNestedBoolean(value: unknown, path: string[]): boolean | null {
  const current = readNestedValue(value, path);
  return typeof current === "boolean" ? current : null;
}

function readNestedValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function readExecutorMode(value: unknown): string | null {
  if (value === "new_task" || value === "failed_task" || value === "resume_interrupted") return value;
  return null;
}
