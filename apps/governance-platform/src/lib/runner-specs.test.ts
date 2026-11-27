import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { buildRunnerSpecsPayload, RunnerSpecAcceptedArtifactMissingError } from "./runner-specs";

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function acceptedArtifactFixture(
  sourceVersion: number,
  workImpact: "requires_loop_work" | "context_only" | "no_loop_work" = "requires_loop_work",
) {
  const suffix = String(sourceVersion).padStart(3, "0");
  const minute = String(sourceVersion % 60).padStart(2, "0");
  return {
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: `SPEC-${suffix}`,
    acceptedAt: `2026-05-16T12:${minute}:00.000Z`,
    source: {
      id: `SRC-${suffix}`,
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-proj-1",
      sourceVersion,
      sourceRefType: "accepted_spec",
      sourceId: `tg-spec-version-${sourceVersion}`,
    },
    acceptedSpec: {
      id: `SPEC-${suffix}`,
      version: sourceVersion,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: "Evolution Spec",
        sections: [],
        requirements: [],
        extensionBlocks: [],
      },
      renderedMarkdown: "Same markdown",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRefs: [`SRC-${suffix}`],
    },
    acceptedDiff: {
      id: `DIFF-${suffix}`,
      baseSpecVersion: sourceVersion - 1,
      targetSpecVersion: sourceVersion,
      summary: `Spec update ${sourceVersion}`,
      items: [{
        id: `DIFF-${suffix}-001`,
        targetType: "spec",
        targetId: `REQ-${suffix}`,
        changeType: "updated",
        workImpact,
        summary: `Spec work ${sourceVersion}`,
        sourceRefs: [`SRC-${suffix}`],
      }],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

describe("runner specs payload", () => {
  it("preserves the legacy content hash shape when no version metadata exists", () => {
    const payload = buildRunnerSpecsPayload([{
      id: "spec-1",
      title: "Main Spec",
      content: "Build the app",
      orderIndex: 0,
      versions: [],
    }]);

    expect(payload.specs).toEqual([{
      id: "spec-1",
      slug: "Main Spec",
      content: "Build the app",
      hash: expect.any(String),
    }]);
    expect(payload.hash).toBe(md5(payload.specs[0].hash));
  });

  it("attaches current version and accepted artifact metadata without changing content hash semantics", () => {
    const acceptedArtifact = {
      artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
      artifactId: "SPEC-008",
      acceptedAt: "2026-05-15T08:59:00.000Z",
      source: {
        id: "SRC-008",
        sourceSystem: "tg-spec",
        sourceProjectId: "tg-proj-1",
        sourceVersion: 8,
        sourceRefType: "accepted_spec",
        sourceId: "tg-spec-version-8",
      },
      acceptedSpec: {
        id: "SPEC-008",
        version: 8,
        document: {
          specSchemaVersion: "ra-287.spec-document.v1",
          title: "Evolution Spec",
          sections: [],
          requirements: [],
          extensionBlocks: [{
            id: "SPEC-LEGACY-MARKDOWN",
            title: "Rendered spec",
            body: "Same markdown",
            reason: "Test fixture.",
            sourceRefs: ["SRC-008"],
          }],
        },
        renderedMarkdown: "Same markdown",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceRefs: ["SRC-008"],
      },
      acceptedDiff: {
        id: "DIFF-008",
        baseSpecVersion: 7,
        targetSpecVersion: 8,
        summary: "BUG-001 reopened",
        items: [{
          id: "DIFF-008-001",
          targetType: "feedback",
          targetId: "BUG-001",
          changeType: "reopened",
          workImpact: "requires_loop_work",
          summary: "Users still see the bug.",
          sourceRefs: ["SRC-008"],
        }],
      },
      feedback: [],
      assumptions: [],
      secretRequirements: [],
      assets: [],
    };

    const payload = buildRunnerSpecsPayload([{
      id: "spec-1",
      title: "Evolution Spec",
      content: "Same markdown",
      orderIndex: 0,
      versions: [{
        id: "spec-version-2",
        version: 2,
        message: "Imported from tg-spec v8",
        createdAt: new Date("2026-05-15T09:00:00.000Z"),
        externalSourceSystem: "tg-spec",
        externalSourceProjectId: "tg-proj-1",
        externalSourceVersion: 8,
        externalSourceUrl: "https://tg-spec.example/projects/tg-proj-1/specs/8",
        externalAcceptedAt: new Date("2026-05-15T08:59:00.000Z"),
        externalMetadataHash: "sha256:metadata-a",
        acceptedArtifact,
      }],
    }]);

    expect(payload.specs[0]).toMatchObject({
      id: "spec-1",
      slug: "Evolution Spec",
      content: "Same markdown",
      hash: expect.any(String),
      inputHash: expect.any(String),
      currentVersion: {
        id: "spec-version-2",
        version: 2,
        message: "Imported from tg-spec v8",
        createdAt: "2026-05-15T09:00:00.000Z",
      },
      source: {
        system: "tg-spec",
        projectId: "tg-proj-1",
        version: 8,
        url: "https://tg-spec.example/projects/tg-proj-1/specs/8",
        acceptedAt: "2026-05-15T08:59:00.000Z",
      },
      acceptedArtifact,
      metadataHash: "sha256:metadata-a",
    });
    expect(payload.specs[0].inputHash).not.toBe(payload.specs[0].hash);
    expect(payload.hash).toBe(md5(payload.specs[0].inputHash as string));
  });

  it("forwards stored v1 acceptedArtifact without legacy metadata fields", () => {
    const acceptedArtifact = {
      artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
      artifactId: "SPEC-009",
      acceptedAt: "2026-05-16T12:00:00.000Z",
      source: {
        id: "SRC-009",
        sourceSystem: "tg-spec",
        sourceProjectId: "tg-proj-1",
        sourceVersion: 9,
        sourceRefType: "accepted_spec",
        sourceId: "tg-spec-version-9",
      },
      acceptedSpec: {
        id: "SPEC-009",
        version: 9,
        document: {
          specSchemaVersion: "ra-287.spec-document.v1",
          title: "Updated spec",
          sections: [],
          requirements: [],
          extensionBlocks: [{
            id: "SPEC-LEGACY-MARKDOWN",
            title: "Rendered spec",
            body: "Same markdown",
            reason: "Bridge fixture.",
            sourceRefs: ["SRC-009"],
          }],
        },
        renderedMarkdown: "Same markdown",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceRefs: ["SRC-009"],
      },
      acceptedDiff: {
        id: "DIFF-009",
        baseSpecVersion: 8,
        targetSpecVersion: 9,
        summary: "BUG-001 reopened",
        items: [{
          id: "DIFF-009-001",
          targetType: "feedback",
          targetId: "BUG-001",
          changeType: "reopened",
          workImpact: "requires_loop_work",
          summary: "Users still see the bug.",
          sourceRefs: ["SRC-009"],
        }],
      },
      feedback: [{
        id: "BUG-001",
        title: "Bug",
        body: "Users still see the bug.",
        state: "reopened",
        reopenCount: 2,
        defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
        sourceRefs: ["SRC-009"],
      }],
      assumptions: [],
      secretRequirements: [],
      assets: [],
    };

    const payload = buildRunnerSpecsPayload([{
      id: "spec-1",
      title: "Evolution Spec",
      content: "Same markdown",
      orderIndex: 0,
      versions: [{
        id: "spec-version-3",
        version: 3,
        message: "Imported from tg-spec v9",
        createdAt: new Date("2026-05-16T12:01:00.000Z"),
        externalSourceSystem: "tg-spec",
        externalSourceProjectId: "tg-proj-1",
        externalSourceVersion: 9,
        externalAcceptedAt: new Date("2026-05-16T12:00:00.000Z"),
        externalMetadataHash: "sha256:metadata-v1",
        acceptedArtifact,
      }],
    }]);

    expect(payload.specs[0]).toMatchObject({
      acceptedArtifact,
      metadataHash: "sha256:metadata-v1",
    });
    expect(payload.specs[0]).not.toHaveProperty("acceptedDelta");
    expect(payload.specs[0]).not.toHaveProperty("provenance");
  });

  it("builds an ordered accepted artifact backlog without collapsing to the latest artifact", () => {
    const artifact63 = acceptedArtifactFixture(63);
    const artifact64 = acceptedArtifactFixture(64);
    const artifact65 = acceptedArtifactFixture(65, "context_only");
    const artifact66 = acceptedArtifactFixture(66);

    const payload = buildRunnerSpecsPayload([{
      id: "spec-1",
      title: "Evolution Spec",
      content: "Same markdown",
      orderIndex: 0,
      versions: [
        {
          id: "spec-version-66",
          version: 4,
          message: "Imported from tg-spec v66",
          createdAt: "2026-05-16T12:04:00.000Z",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 66,
          externalAcceptedAt: "2026-05-16T12:04:00.000Z",
          externalMetadataHash: "sha256:metadata-66",
          acceptedArtifact: artifact66,
        },
        {
          id: "spec-version-65",
          version: 3,
          message: "Imported from tg-spec v65",
          createdAt: "2026-05-16T12:03:00.000Z",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 65,
          externalAcceptedAt: "2026-05-16T12:03:00.000Z",
          externalMetadataHash: "sha256:metadata-65",
          acceptedArtifact: artifact65,
        },
        {
          id: "spec-version-64",
          version: 2,
          message: "Imported from tg-spec v64",
          createdAt: "2026-05-16T12:02:00.000Z",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 64,
          externalAcceptedAt: "2026-05-16T12:02:00.000Z",
          externalMetadataHash: "sha256:metadata-64",
          acceptedArtifact: artifact64,
        },
        {
          id: "spec-version-63",
          version: 1,
          message: "Imported from tg-spec v63",
          createdAt: "2026-05-16T12:01:00.000Z",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 63,
          externalAcceptedAt: "2026-05-16T12:01:00.000Z",
          externalMetadataHash: "sha256:metadata-63",
          acceptedArtifact: artifact63,
        },
      ],
    }]);

    expect(payload.specs[0].acceptedArtifact).toMatchObject({
      source: { sourceVersion: 66 },
    });
    expect(payload.specs[0].acceptedArtifactBacklog?.map((entry: any) => ({
      specVersionId: entry.currentVersion.id,
      sourceVersion: entry.source.version,
      workImpact: entry.acceptedArtifact.acceptedDiff.items[0].workImpact,
      metadataHash: entry.metadataHash,
    }))).toEqual([
      {
        specVersionId: "spec-version-63",
        sourceVersion: 63,
        workImpact: "requires_loop_work",
        metadataHash: "sha256:metadata-63",
      },
      {
        specVersionId: "spec-version-64",
        sourceVersion: 64,
        workImpact: "requires_loop_work",
        metadataHash: "sha256:metadata-64",
      },
      {
        specVersionId: "spec-version-65",
        sourceVersion: 65,
        workImpact: "context_only",
        metadataHash: "sha256:metadata-65",
      },
      {
        specVersionId: "spec-version-66",
        sourceVersion: 66,
        workImpact: "requires_loop_work",
        metadataHash: "sha256:metadata-66",
      },
    ]);
    expect(payload.specs[0].inputHash).toBe(md5([
      payload.specs[0].hash,
      "sha256:metadata-63",
      "sha256:metadata-64",
      "sha256:metadata-65",
      "sha256:metadata-66",
    ].join(":")));
    expect(payload.specs[0].inputHash).not.toBe(md5(`${payload.specs[0].hash}:sha256:metadata-66`));
  });

  it("fails loudly for external accepted spec metadata without acceptedArtifact", () => {
    const baseSpec = {
      id: "spec-1",
      title: "Evolution Spec",
      content: "Same markdown",
      orderIndex: 0,
      versions: [{
        id: "spec-version-2",
        version: 2,
        message: null,
        createdAt: "2026-05-15T09:00:00.000Z",
        externalSourceSystem: "tg-spec",
        externalSourceProjectId: "tg-proj-1",
        externalSourceVersion: 8,
        externalMetadataHash: "sha256:metadata-a",
      }],
    };

    expect(() => buildRunnerSpecsPayload([baseSpec])).toThrow(RunnerSpecAcceptedArtifactMissingError);
    expect(() => buildRunnerSpecsPayload([baseSpec])).toThrow(
      /Spec version spec-version-2 has accepted external spec metadata but no acceptedArtifact/,
    );
  });
});
