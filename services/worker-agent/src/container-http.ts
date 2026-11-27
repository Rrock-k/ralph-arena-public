export function isDockerNotFoundError(err: unknown): boolean {
  const code = getDockerStatusCode(err);
  if (code === 404) return true;

  const message = getDockerErrorMessage(err);
  return message.includes("no such container")
    || message.includes("No such container")
    || message.includes("404");
}

export function dockerMutationStatus(err: unknown): number {
  const code = getDockerStatusCode(err);
  if (code === 404) return 404;
  if (code === 304) return 200;
  if (code === 409) return 409;

  const message = getDockerErrorMessage(err);
  if (isDockerNotFoundError(err)) return 404;
  if (message.includes("is already stopped") || message.includes("is not running")) return 200;
  if (message.includes("is already running") || message.includes("is already started")) return 200;
  return 500;
}

function getDockerStatusCode(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as { statusCode?: unknown; status?: unknown };
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  if (typeof candidate.status === "number") return candidate.status;
  return null;
}

function getDockerErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "");
}
