import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it } from "vitest";
import { buildCombinedSpecContent, buildSpecInputManifest, syncSpecWorkspace } from "./specs.js";

const tempRoots: string[] = [];

function makeTempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-specs-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("spec workspace sync", () => {
  it("builds a combined spec snapshot with the project title header", () => {
    expect(buildCombinedSpecContent([
      { id: "spec-1", slug: "alpha", content: "First", hash: "h1" },
      { id: "spec-2", slug: "beta", content: "Second", hash: "h2" },
    ], "Resident Loop")).toContain("# Project: Resident Loop");
  });

  it("syncs both specs/ files and spec.md together", () => {
    const workspaceDir = makeTempWorkspace();
    const specsDir = join(workspaceDir, "specs");

    syncSpecWorkspace(workspaceDir, specsDir, [
      { id: "spec-1", slug: "Alpha Spec", content: "First body", hash: "h1" },
      { id: "spec-2", slug: "Beta Spec", content: "Second body", hash: "h2" },
    ], "Resident Loop");

    expect(readdirSync(specsDir).sort()).toEqual([
      "000-project.md",
      "001-alpha-spec-ec-1.md",
      "002-beta-spec-ec-2.md",
    ]);
    expect(readFileSync(join(workspaceDir, "spec.md"), "utf-8")).toContain("# Alpha Spec\n\nFirst body");
    expect(readFileSync(join(workspaceDir, "spec.md"), "utf-8")).toContain("# Beta Spec\n\nSecond body");
  });

  it("writes runner spec input metadata for Ralph without changing spec markdown", () => {
    const workspaceDir = makeTempWorkspace();
    const specsDir = join(workspaceDir, "specs");
    const acceptedArtifact = {
      artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
      artifactId: "SPEC-001",
      acceptedAt: "2026-05-16T12:00:00Z",
      source: {
        id: "SRC-001",
        sourceSystem: "tg-spec",
        sourceProjectId: "tg-proj-1",
        sourceVersion: 8,
        sourceRefType: "accepted_spec",
        sourceId: "tg-spec-version-8",
      },
      acceptedSpec: {
        id: "SPEC-001",
        version: 8,
        document: {
          specSchemaVersion: "ra-287.spec-document.v1",
          title: "Alpha Spec",
          sections: [],
          requirements: [],
          extensionBlocks: [],
        },
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceRefs: ["SRC-001"],
      },
      acceptedDiff: {
        id: "DIFF-001",
        targetSpecVersion: 8,
        summary: "BUG-005 reopened",
        items: [
          {
            id: "DIFF-001-001",
            targetType: "feedback",
            targetId: "BUG-005",
            changeType: "reopened",
            workImpact: "requires_loop_work",
            summary: "Users still see the bug.",
            sourceRefs: ["SRC-001"],
          },
          {
            id: "DIFF-001-002",
            targetType: "spec",
            targetId: "REQ-HTML",
            changeType: "updated",
            workImpact: "requires_loop_work",
            summary: "Game UI must use HTML elements, not canvas.",
            sourceRefs: ["SRC-001"],
          },
        ],
      },
      feedback: [],
      assumptions: [],
      secretRequirements: [],
      assets: [],
    };

    syncSpecWorkspace(workspaceDir, specsDir, [{
      id: "spec-1",
      slug: "Alpha Spec",
      content: "Same body",
      hash: "content-hash",
      inputHash: "input-hash",
      acceptedArtifact,
      metadataHash: "sha256:metadata",
    }], "Resident Loop");

    const manifest = JSON.parse(readFileSync(join(workspaceDir, ".arena", "spec-input.json"), "utf-8"));
    expect(manifest).toEqual(buildSpecInputManifest([{
      id: "spec-1",
      slug: "Alpha Spec",
      content: "Same body",
      hash: "content-hash",
      inputHash: "input-hash",
      acceptedArtifact: expect.objectContaining({
        artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
        acceptedDiff: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              id: "DIFF-001-002",
              targetType: "spec",
              targetId: "REQ-HTML",
            }),
          ]),
        }),
      }),
      metadataHash: "sha256:metadata",
    }]));
    expect(readFileSync(join(workspaceDir, "spec.md"), "utf-8")).not.toContain("accepted_spec_delta");
  });

  it("preserves accepted artifact backlog entries in the runner manifest", () => {
    const workspaceDir = makeTempWorkspace();
    const specsDir = join(workspaceDir, "specs");
    const acceptedArtifactBacklog = [
      {
        currentVersion: { id: "spec-version-63", version: 63, createdAt: "2026-07-02T00:00:00.000Z" },
        source: { system: "tg-spec", projectId: "tg-proj-1", version: 63 },
        metadataHash: "sha256:metadata-63",
        acceptedArtifact: { source: { sourceVersion: 63 }, acceptedDiff: { items: [] } },
      },
      {
        currentVersion: { id: "spec-version-64", version: 64, createdAt: "2026-07-02T00:01:00.000Z" },
        source: { system: "tg-spec", projectId: "tg-proj-1", version: 64 },
        metadataHash: "sha256:metadata-64",
        acceptedArtifact: { source: { sourceVersion: 64 }, acceptedDiff: { items: [] } },
      },
    ];

    syncSpecWorkspace(workspaceDir, specsDir, [{
      id: "spec-1",
      slug: "Alpha Spec",
      content: "Same body",
      hash: "content-hash",
      inputHash: "input-hash",
      acceptedArtifactBacklog,
    }], "Resident Loop");

    const manifest = JSON.parse(readFileSync(join(workspaceDir, ".arena", "spec-input.json"), "utf-8"));

    expect(manifest.specs[0].acceptedArtifactBacklog).toEqual(acceptedArtifactBacklog);
  });
});
