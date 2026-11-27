import { timingSafeEqual } from "node:crypto";

export const PREVIEW_REFRESH_TOKEN_HEADER = "x-arena-preview-refresh-token";

export type PreviewRefreshAuthResult =
  | { kind: "not_provided" }
  | { kind: "authorized"; projectId: string }
  | { kind: "denied"; status: 401 | 403 | 503; error: string };

function readConfiguredToken(): string | null {
  const value = process.env.ARENA_PREVIEW_REFRESH_TOKEN?.trim();
  return value || null;
}

function readAllowedProjectIds(): Set<string> {
  return new Set(
    (process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function secretsEqual(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function getPreviewRefreshAuthResult(
  request: Request,
  input: { method: string; path: string[] },
): PreviewRefreshAuthResult {
  const provided = request.headers.get(PREVIEW_REFRESH_TOKEN_HEADER)?.trim();
  if (!provided) return { kind: "not_provided" };

  const projectId = input.path[1];
  const isPreviewRefresh =
    input.method === "POST" &&
    input.path.length === 3 &&
    input.path[0] === "projects" &&
    Boolean(projectId) &&
    input.path[2] === "preview-refresh";
  const isPreviewStatus =
    input.method === "GET" &&
    input.path.length === 3 &&
    input.path[0] === "projects" &&
    Boolean(projectId) &&
    input.path[2] === "preview-status";

  if (!isPreviewRefresh && !isPreviewStatus) {
    return {
      kind: "denied",
      status: 403,
      error: "Preview refresh token is not authorized for this endpoint",
    };
  }

  const expected = readConfiguredToken();
  if (!expected) {
    return {
      kind: "denied",
      status: 503,
      error: "Preview refresh API not configured",
    };
  }

  if (!secretsEqual(provided, expected)) {
    return { kind: "denied", status: 401, error: "Unauthorized" };
  }

  if (!readAllowedProjectIds().has(projectId)) {
    return {
      kind: "denied",
      status: 403,
      error: "Preview refresh is not allowed for this project",
    };
  }

  return { kind: "authorized", projectId };
}
