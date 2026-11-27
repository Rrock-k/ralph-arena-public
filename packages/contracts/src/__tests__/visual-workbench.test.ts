import { describe, expect, it } from "vitest";
import {
  VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
  getVisualWorkbenchManifestIssueCodes,
  getVisualWorkbenchManifestIssueDetails,
  parseVisualWorkbenchManifest,
  readVisualWorkbenchManifestSchemaVersion,
  summarizeVisualWorkbenchManifest,
} from "../visual-workbench.js";

describe("Visual Workbench manifest contract", () => {
  it("parses and summarizes v0 ordinary-web workbench manifests", () => {
    const manifest = parseVisualWorkbenchManifest(validManifest());

    expect(manifest.schemaVersion).toBe(VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION);
    expect(summarizeVisualWorkbenchManifest(manifest)).toEqual({
      storyCount: 2,
      features: ["jam-room", "transport"],
      widgets: ["JamRoom", "TransportControls"],
      states: ["empty", "playing"],
      viewportNames: ["desktop", "mobile"],
      stories: [{
        id: "jam-room.empty.mobile",
        title: "jam-room.empty.mobile",
        kind: "feature",
        feature: "jam-room",
        widget: "JamRoom",
        state: "empty",
        route: "/__visual/jam-room.empty.mobile",
        mockStateName: "jam-room.empty.mobile",
        viewportNames: ["mobile"],
        taskRelevanceDefaultFor: ["feature:jam-room"],
      }, {
        id: "transport.playing.desktop",
        title: "transport.playing.desktop",
        kind: "feature",
        feature: "transport",
        widget: "TransportControls",
        state: "playing",
        route: "/__visual/transport.playing.desktop",
        mockStateName: "transport.playing.desktop",
        viewportNames: ["desktop"],
        taskRelevanceDefaultFor: ["feature:jam-room"],
      }],
    });
  });

  it("maps manifest violations to stable readiness issue codes", () => {
    const story = validStory({ id: "jam-room.empty.mobile" });
    const manifest = {
      ...validManifest({ stories: [story, story] }),
      coveragePolicy: {
        mode: "narrow",
        selectionDefault: "changed_only",
        simplificationRequiresEvidence: false,
      },
    };
    expect(getVisualWorkbenchManifestIssueCodes(manifest)).toEqual([
      "coverage_policy_unsupported",
      "story_id_duplicate",
    ]);
    expect(getVisualWorkbenchManifestIssueDetails(manifest).filter((detail) => (
      detail.code === "story_id_duplicate"
    ))).toHaveLength(1);
  });

  it("does not accept missing stories as capture-ready", () => {
    expect(getVisualWorkbenchManifestIssueCodes({
      ...validManifest({ stories: [] }),
    })).toEqual(["strict_state_gap"]);
  });

  it("reads the declared schema version even when the manifest is unsupported", () => {
    expect(readVisualWorkbenchManifestSchemaVersion({
      ...validManifest(),
      schemaVersion: "ra-356.visual-coverage-manifest.v1",
    })).toBe("ra-356.visual-coverage-manifest.v1");
    expect(readVisualWorkbenchManifestSchemaVersion({})).toBeNull();
  });

  it("rejects story render paths that do not match the declared route pattern", () => {
    expect(getVisualWorkbenchManifestIssueCodes(validManifest({
      stories: [
        validStory({
          id: "jam-room.page-fallback",
          feature: "jam-room",
          widget: "JamRoom",
          state: "empty",
          viewport: { name: "mobile", width: 390, height: 844 },
          renderPath: "/",
        }),
      ],
    }))).toEqual(["story_route_pattern_mismatch"]);
  });

  it("returns actionable manifest issue details without relaxing validation", () => {
    const manifest = validManifest({
      stories: [{
        ...validStory({ id: "jam-room.empty.mobile" }),
        source: "stories/jam-room.empty.mobile.json",
      }],
    });

    expect(getVisualWorkbenchManifestIssueCodes(manifest)).toEqual(["story_required_field_missing"]);
    expect(getVisualWorkbenchManifestIssueDetails(manifest)).toEqual([
      expect.objectContaining({
        code: "story_required_field_missing",
        path: ["stories", 0],
        field: "source",
        storyIndex: 0,
        storyId: "jam-room.empty.mobile",
        keys: ["source"],
      }),
    ]);
    expect(() => parseVisualWorkbenchManifest(manifest)).toThrow();
  });
});

function validManifest(input: {
  stories?: Record<string, unknown>[];
} = {}) {
  return {
    schemaVersion: VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
    projectClass: "ordinary_web",
    workbench: {
      serveCommand: "npm run visual-workbench",
      baseUrlEnv: "VISUAL_WORKBENCH_BASE_URL",
      storyRoutePattern: "/__visual/:storyId",
    },
    coveragePolicy: {
      mode: "strict_canary",
      selectionDefault: "full_manifest",
      simplificationRequiresEvidence: true,
    },
    stories: input.stories ?? [
      validStory({
        id: "jam-room.empty.mobile",
        feature: "jam-room",
        widget: "JamRoom",
        state: "empty",
        viewport: { name: "mobile", width: 390, height: 844 },
      }),
      validStory({
        id: "transport.playing.desktop",
        feature: "transport",
        widget: "TransportControls",
        state: "playing",
        viewport: { name: "desktop", width: 1440, height: 900 },
      }),
    ],
  };
}

function validStory(input: {
  id: string;
  feature?: string;
  widget?: string;
  state?: string;
  viewport?: { name: string; width: number; height: number };
  renderPath?: string;
}) {
  return {
    id: input.id,
    title: input.id,
    kind: "feature",
    feature: input.feature ?? "jam-room",
    widget: input.widget ?? "JamRoom",
    state: input.state ?? "empty",
    claim: "The UI renders the expected isolated state.",
    render: {
      type: "workbench_route",
      path: input.renderPath ?? `/__visual/${input.id}`,
    },
    mockState: {
      name: input.id,
    },
    viewports: [input.viewport ?? { name: "mobile", width: 390, height: 844 }],
    tags: ["ui"],
    taskRelevance: {
      defaultFor: ["feature:jam-room"],
    },
  };
}
