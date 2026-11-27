import { describe, expect, it } from "vitest";
import {
  buildFleetSpecArtifactAudit,
  buildProjectSpecArtifactAudit,
} from "./spec-artifact-audit";

function baseProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Project One",
    tgSpecSourceProjectId: "tg-project-1",
    tgSpecMirrorSpecId: "spec-1",
    tgSpecLastImportedVersion: 3,
    specs: [{
      id: "spec-1",
      title: "Spec",
      content: "# Spec",
      orderIndex: 0,
      versions: [{
        id: "spec-version-3",
        version: 3,
        content: "# Spec",
        message: "Imported",
        externalSourceProjectId: "tg-project-1",
        externalSourceVersion: 3,
        externalSourceUrl: "https://tg-spec.example/projects/tg-project-1/specs/3",
        externalMetadataHash: "sha256:metadata",
        acceptedArtifact: null,
      }],
    }],
    ...overrides,
  } as any;
}

function validAcceptedArtifact() {
  return {
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: "SPEC-003",
    acceptedAt: "2026-05-16T12:00:00.000Z",
    source: {
      id: "SRC-003",
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-project-1",
      sourceVersion: 3,
      sourceRefType: "accepted_spec",
      sourceId: "tg-spec-version-3",
    },
    acceptedSpec: {
      id: "SPEC-003",
      version: 3,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: "Spec",
        sections: [],
        requirements: [],
        extensionBlocks: [{
          id: "SPEC-LEGACY-MARKDOWN",
          title: "Rendered spec",
          body: "# Spec",
          reason: "Test fixture.",
          sourceRefs: ["SRC-003"],
        }],
      },
      renderedMarkdown: "# Spec",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRefs: ["SRC-003"],
    },
    acceptedDiff: {
      id: "DIFF-003",
      targetSpecVersion: 3,
      summary: "No changes",
      items: [],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

function withLatestAcceptedArtifact(acceptedArtifact: unknown) {
  return baseProject({
    specs: [{
      id: "spec-1",
      title: "Spec",
      content: "# Spec",
      orderIndex: 0,
      versions: [{
        id: "spec-version-3",
        version: 3,
        content: "# Spec",
        message: "Imported",
        externalSourceProjectId: "tg-project-1",
        externalSourceVersion: 3,
        externalSourceUrl: "https://tg-spec.example/projects/tg-project-1/specs/3",
        externalMetadataHash: "sha256:metadata",
        acceptedArtifact,
      }],
    }],
  });
}

function archived(project: any) {
  return {
    ...project,
    archivedAt: new Date("2026-05-16T00:00:00.000Z"),
  };
}

describe("buildProjectSpecArtifactAudit", () => {
  it("classifies stored v1 accepted artifacts as current and runner-ready", () => {
    const audit = buildProjectSpecArtifactAudit(withLatestAcceptedArtifact(validAcceptedArtifact()));

    expect(audit).toMatchObject({
      classification: "current_v1_artifact",
      runnerReady: true,
      storageMode: "accepted_artifact_v1",
      recommendedNextAction: "launch_or_resume",
    });
  });

  it("classifies markdown-only specs without inventing product truth", () => {
    const audit = buildProjectSpecArtifactAudit(baseProject());

    expect(audit).toMatchObject({
      classification: "markdown_only_spec",
      runnerReady: false,
      storageMode: "markdown_only",
      recommendedNextAction: "reimport_from_tg_spec",
    });
    expect(audit.allowedActions).toEqual([
      "reimport_from_tg_spec",
      "manual_artifact_repair",
      "park_for_later_repair",
    ]);
    expect(audit.operatorNotes.join(" ")).toMatch(/Do not derive public task projections/);
    expect(audit.operatorNotes.join(" ")).toMatch(/Repair or re-import the accepted artifact before launch\/resume/);
  });

  it("prefers the tg-spec mirror spec over earlier addon specs", () => {
    const audit = buildProjectSpecArtifactAudit(baseProject({
      tgSpecMirrorSpecId: "mirror-spec",
      tgSpecLastImportedVersion: 13,
      specs: [
        {
          id: "addon-spec",
          title: "Addon: Telegram Mini App",
          content: "# Addon",
          orderIndex: 0,
          versions: [{
            id: "addon-version-1",
            version: 1,
            content: "# Addon",
            message: "Addon",
            externalSourceProjectId: null,
            externalSourceVersion: null,
            externalSourceUrl: null,
            externalMetadataHash: "sha256:addon",
            acceptedArtifact: validAcceptedArtifact(),
          }],
        },
        {
          id: "mirror-spec",
          title: "Evolution Spec",
          content: "# Mirror",
          orderIndex: 1,
          versions: [{
            id: "mirror-version-13",
            version: 13,
            content: "# Mirror",
            message: "Imported",
            externalSourceProjectId: "tg-project-1",
            externalSourceVersion: 13,
            externalSourceUrl: "https://tg-spec.example/projects/tg-project-1/specs/13",
            externalMetadataHash: "sha256:mirror",
            acceptedArtifact: null,
          }],
        },
      ],
    }));

    expect(audit).toMatchObject({
      classification: "markdown_only_spec",
      runnerReady: false,
      latestSpec: {
        specId: "mirror-spec",
        specVersionId: "mirror-version-13",
        sourceProjectId: "tg-project-1",
        sourceVersion: 13,
      },
    });
  });

  it("classifies malformed metadata as repair-required", () => {
    const audit = buildProjectSpecArtifactAudit(withLatestAcceptedArtifact({ schemaVersion: 1 }));

    expect(audit).toMatchObject({
      classification: "malformed_metadata",
      runnerReady: false,
      storageMode: "invalid",
      recommendedNextAction: "reimport_from_tg_spec",
    });
  });

  it("classifies secret-looking metadata as unsafe", () => {
    const unsafeArtifact: any = validAcceptedArtifact();
    unsafeArtifact.feedback = [{
      id: "BUG-SECRET",
      title: "Leaked token",
      body: "The real token is sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      state: "open",
      defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
      sourceRefs: ["SRC-003"],
    }];
    const audit = buildProjectSpecArtifactAudit(withLatestAcceptedArtifact(unsafeArtifact));

    expect(audit).toMatchObject({
      classification: "unsafe_metadata",
      runnerReady: false,
      recommendedNextAction: "redact_or_remove_metadata_at_source",
    });
  });
});

describe("buildFleetSpecArtifactAudit", () => {
  it("summarizes all-current v1 projects without inventing a repair wave", () => {
    const audit = buildFleetSpecArtifactAudit([
      withLatestAcceptedArtifact(validAcceptedArtifact()),
    ]);

    expect(audit).toMatchObject({
      truth: {
        scannedProjects: 1,
        currentV1Artifacts: 1,
        repairRequired: 0,
        runnerReady: 1,
      },
      classification: {
        status: "all_current_v1_artifacts",
        repairCohorts: [],
      },
      recommendedNextAction: "no_action",
    });
    expect(audit.projects).toEqual([]);
  });

  it("orders repair-required projects without exposing current v1 rows", () => {
    const unsafeArtifact: any = validAcceptedArtifact();
    unsafeArtifact.feedback = [{
      id: "BUG-SECRET",
      title: "Leaked token",
      body: "The real token is sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      state: "open",
      defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
      sourceRefs: ["SRC-003"],
    }];

    const audit = buildFleetSpecArtifactAudit([
      baseProject({ id: "project-markdown", name: "Markdown" }),
      withLatestAcceptedArtifact({ schemaVersion: 1 }),
      archived(withLatestAcceptedArtifact(validAcceptedArtifact())),
      withLatestAcceptedArtifact(unsafeArtifact),
      baseProject({ id: "project-empty", name: "Empty", specs: [] }),
    ], { limitProjects: 3 });

    expect(audit.truth).toMatchObject({
      scannedProjects: 5,
      currentV1Artifacts: 1,
      markdownOnlySpecs: 1,
      malformedMetadata: 1,
      unsafeMetadata: 1,
      noSpec: 1,
      runnerReady: 1,
      repairRequired: 4,
    });
    expect(audit.classification).toEqual({
      status: "artifact_repair_required",
      repairCohorts: [
        { classification: "unsafe_metadata", count: 1 },
        { classification: "malformed_metadata", count: 1 },
        { classification: "markdown_only_spec", count: 1 },
        { classification: "no_spec", count: 1 },
      ],
    });
    expect(audit.recommendedNextAction).toBe("redact_or_remove_metadata_at_source");
    expect(audit.projects.map((project) => project.classification)).toEqual([
      "unsafe_metadata",
      "malformed_metadata",
      "markdown_only_spec",
    ]);
    expect(audit.projects).toHaveLength(3);
    expect(audit.projects.some((project) => project.classification === "current_v1_artifact")).toBe(false);
  });
});
