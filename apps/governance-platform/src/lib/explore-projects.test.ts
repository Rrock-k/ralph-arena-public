import { describe, expect, it } from "vitest";
import {
  getExplorePreviewUrl,
  getExploreVisibilityList,
  isProjectVisibleInExplore,
  sortExploreProjects,
} from "./explore-projects";

describe("isProjectVisibleInExplore", () => {
  const healthyPreviewComponent = [{
    kind: "app",
    powerIntent: "ON",
    agentIntent: "ON",
    runtimeState: "RUNNING",
    agentState: "IDLE",
    lastOutcome: "COMPLETED",
    previewHealth: "HEALTHY",
  }];

  it("keeps featured retained previews visible while the live app is still serving", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "featured",
        archivedAt: null,
        components: [{ previewUrl: "https://preview.example.com", ...healthyPreviewComponent[0] }],
      }),
    ).toBe(true);
  });

  it("keeps featured retained previews visible after failed runs if the live app is still serving", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "featured",
        archivedAt: null,
        components: [{
          ...healthyPreviewComponent[0],
          previewUrl: "https://preview.example.com",
          lastOutcome: "FAILED",
        }],
      }),
    ).toBe(true);
  });

  it("does not surface failed public projects", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "public",
        components: [{ kind: "app", previewUrl: "https://preview.example.com", previewHealth: "HEALTHY", agentState: "FAILED" }],
      }),
    ).toBe(false);
  });

  it("does not surface public projects for guests", () => {
    expect(
      isProjectVisibleInExplore(
        {
          visibility: "public",
          components: [{ kind: "app", previewUrl: "https://preview.example.com", previewHealth: "HEALTHY", agentState: "RUNNING" }],
        },
        { isAuthenticated: false },
      ),
    ).toBe(false);
  });

  it("still requires an actual preview URL", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "featured",
        previewUrl: null,
        components: healthyPreviewComponent,
      }),
    ).toBe(false);
  });

  it("uses component previewUrl before the stale project-row mirror", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "featured",
        components: [{
          kind: "app",
          powerIntent: "ON",
          agentIntent: "ON",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: "COMPLETED",
          previewUrl: "https://preview.example.com",
          previewHealth: "HEALTHY",
        }],
      }),
    ).toBe(true);
  });

  it("resolves the component previewUrl before the stale project-row mirror", () => {
    expect(
      getExplorePreviewUrl({
        components: [
          {
            kind: "app",
            previewUrl: "https://fresh.example.com",
            previewHealth: "HEALTHY",
          },
        ],
      }),
    ).toBe("https://fresh.example.com");
  });

  it("does not surface projects whose app container is not running", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "featured",
        components: [{ kind: "app", previewUrl: "https://preview.example.com", previewHealth: "UNHEALTHY" }],
      }),
    ).toBe(false);
  });

  it("surfaces featured personal projects", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "featured",
        archivedAt: null,
        components: [{ previewUrl: "https://preview.example.com", ...healthyPreviewComponent[0] }],
      }),
    ).toBe(true);
  });

  it("does not surface active agent-run rows just because the container is running", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "public",
        components: [{ kind: "app", previewUrl: "https://preview.example.com", previewHealth: "UNKNOWN", runtimeState: "RUNNING", agentState: "RUNNING" }],
      }),
    ).toBe(false);
  });

  it("surfaces live parked preview-only public projects for authenticated users", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "public",
        components: [{
          kind: "app",
          previewUrl: "https://preview.example.com",
          powerIntent: "ON",
          agentIntent: "OFF",
          previewHealth: "UNKNOWN",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          lastOutcome: null,
        }],
      }),
    ).toBe(true);
  });

  it("surfaces live blocked public projects for authenticated users", () => {
    expect(
      isProjectVisibleInExplore({
        visibility: "public",
        components: [{
          kind: "app",
          previewUrl: "https://preview.example.com",
          previewHealth: "HEALTHY",
          runtimeState: "RUNNING",
          agentState: "IDLE",
          blockers: ["RATE_LIMIT"],
        }],
      }),
    ).toBe(true);
  });
});

describe("getExploreVisibilityList", () => {
  it("returns only featured visibility for guests", () => {
    expect(getExploreVisibilityList(false)).toEqual(["featured"]);
  });

  it("returns featured and public visibility for authenticated users", () => {
    expect(getExploreVisibilityList(true)).toEqual(["featured", "public"]);
  });
});

describe("sortExploreProjects", () => {
  it("sorts newer createdAt rows ahead of older ones", () => {
    const projects = sortExploreProjects([
      { id: "old", createdAt: new Date("2026-04-01T00:00:00Z") },
      { id: "new", createdAt: new Date("2026-04-15T00:00:00Z") },
      { id: "mid", createdAt: new Date("2026-04-10T00:00:00Z") },
    ]);

    expect(projects.map((project) => project.id)).toEqual(["new", "mid", "old"]);
  });

  it("sorts explicit explore ranks ahead of unranked projects", () => {
    const projects = sortExploreProjects([
      { id: "new", createdAt: new Date("2026-04-15T00:00:00Z"), exploreRank: null },
      { id: "second", createdAt: new Date("2026-04-01T00:00:00Z"), exploreRank: 2 },
      { id: "first", createdAt: new Date("2026-04-10T00:00:00Z"), exploreRank: 1 },
    ]);

    expect(projects.map((project) => project.id)).toEqual(["first", "second", "new"]);
  });
});
