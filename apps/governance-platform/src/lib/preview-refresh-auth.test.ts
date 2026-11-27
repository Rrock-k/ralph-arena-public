import { afterEach, describe, expect, it } from "vitest";

import {
  getPreviewRefreshAuthResult,
  PREVIEW_REFRESH_TOKEN_HEADER,
} from "./preview-refresh-auth";

const originalToken = process.env.ARENA_PREVIEW_REFRESH_TOKEN;
const originalProjects = process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;

function authorize(input: { token?: string; method: string; path: string[] }) {
  const request = new Request("https://app.arena.example.test/api/admin/ctl/" + input.path.join("/"), {
    method: input.method,
    headers: input.token ? { [PREVIEW_REFRESH_TOKEN_HEADER]: input.token } : {},
  });
  return getPreviewRefreshAuthResult(request, {
    method: input.method,
    path: input.path,
  });
}

afterEach(() => {
  if (originalToken === undefined) delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
  else process.env.ARENA_PREVIEW_REFRESH_TOKEN = originalToken;
  if (originalProjects === undefined) delete process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS;
  else process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = originalProjects;
});

describe("preview refresh delegated auth", () => {
  it("leaves ordinary admin auth in control without a delegated token", () => {
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    expect(authorize({ method: "GET", path: ["projects", "project-1", "preview-status"] }))
      .toEqual({ kind: "not_provided" });
  });

  it.each([
    { method: "POST", path: ["projects", "project-1", "preview-refresh"] },
    { method: "GET", path: ["projects", "project-1", "preview-status"] },
  ])("authorizes $method $path for an allowlisted project", ({ method, path }) => {
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1, project-2";
    expect(authorize({ token: "preview-secret", method, path }))
      .toEqual({ kind: "authorized", projectId: "project-1" });
  });

  it.each([
    { method: "POST", path: ["projects", "project-1", "power-off"] },
    { method: "POST", path: ["projects", "create"] },
    { method: "GET", path: ["projects", "project-1", "health"] },
    { method: "GET", path: ["projects", "project-1", "preview-refresh"] },
    { method: "POST", path: ["projects", "project-1", "preview-status"] },
  ])("rejects the delegated token on $method $path", ({ method, path }) => {
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    expect(authorize({ token: "preview-secret", method, path })).toEqual({
      kind: "denied",
      status: 403,
      error: "Preview refresh token is not authorized for this endpoint",
    });
  });

  it("rejects an incorrect delegated token", () => {
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    expect(authorize({
      token: "wrong-secret",
      method: "GET",
      path: ["projects", "project-1", "preview-status"],
    })).toEqual({ kind: "denied", status: 401, error: "Unauthorized" });
  });

  it("rejects a project outside the allowlist", () => {
    process.env.ARENA_PREVIEW_REFRESH_TOKEN = "preview-secret";
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-2";
    expect(authorize({
      token: "preview-secret",
      method: "GET",
      path: ["projects", "project-1", "preview-status"],
    })).toEqual({
      kind: "denied",
      status: 403,
      error: "Preview refresh is not allowed for this project",
    });
  });

  it("returns 503 when the delegated token is not configured", () => {
    delete process.env.ARENA_PREVIEW_REFRESH_TOKEN;
    process.env.ARENA_PREVIEW_REFRESH_PROJECT_IDS = "project-1";
    expect(authorize({
      token: "preview-secret",
      method: "GET",
      path: ["projects", "project-1", "preview-status"],
    })).toEqual({
      kind: "denied",
      status: 503,
      error: "Preview refresh API not configured",
    });
  });
});
