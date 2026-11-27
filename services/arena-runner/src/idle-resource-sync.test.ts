import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { syncIdleResourceUpdates } from "./idle-resource-sync.js";

const tempRoots: string[] = [];

function makeTempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "arena-runner-idle-sync-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function acceptedArtifact(workImpact: "requires_loop_work" | "context_only" | "no_loop_work") {
  return {
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: "SPEC-ARTIFACT-001",
    acceptedAt: "2026-05-22T15:08:07.069Z",
    source: {
      id: "SRC-001",
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-proj-1",
      sourceVersion: 27,
      sourceRefType: "accepted_spec",
      sourceId: "tg-spec-version-27",
    },
    acceptedSpec: {
      id: "SPEC-001",
      version: 27,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: "Product Spec",
        sections: [],
        requirements: [],
        extensionBlocks: [],
      },
      renderedMarkdown: "# Product Spec\n\nCurrent truth.",
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRefs: ["SRC-001"],
    },
    acceptedDiff: {
      id: "DIFF-001",
      baseSpecVersion: 26,
      targetSpecVersion: 27,
      summary: "Accepted update.",
      items: [{
        id: "DIFF-001-001",
        targetType: workImpact === "context_only" ? "assumption" : "feedback",
        targetId: workImpact === "context_only" ? "ASM-001" : "BUG-001",
        changeType: workImpact === "context_only" ? "created" : "reopened",
        workImpact,
        summary: "Accepted diff item.",
        sourceRefs: ["SRC-001"],
      }],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

function changedSpecs(workImpact?: "requires_loop_work" | "context_only" | "no_loop_work") {
  return {
    hash: `new-${workImpact ?? "plain"}`,
    specs: [{
      id: "spec-1",
      slug: "Product Spec",
      content: "# Product Spec\n\nCurrent truth.",
      hash: "content-hash",
      ...(workImpact ? { acceptedArtifact: acceptedArtifact(workImpact) } : {}),
    }],
  };
}

describe("syncIdleResourceUpdates", () => {
  it("syncs context-only accepted spec changes without marking pending loop work", async () => {
    const workspaceDir = makeTempWorkspace();
    const specsDir = join(workspaceDir, "specs");
    mkdirSync(specsDir, { recursive: true });

    const result = await syncIdleResourceUpdates({
      workspaceDir,
      specsDir,
      projectTitle: "Sushi Kitties",
      currentSpecsHash: "old",
      currentAssetsHash: "assets",
      checkSpecChangesFn: async () => changedSpecs("context_only"),
      checkAssetChangesFn: async () => null,
    });

    expect(result.pendingLoopWork).toBe(false);
    expect(result.currentSpecsHash).toBe("new-context_only");
    expect(readFileSync(join(workspaceDir, "spec.md"), "utf-8")).toContain("Current truth.");
  });

  it("marks pending loop work for implementable accepted diff changes", async () => {
    const workspaceDir = makeTempWorkspace();
    const specsDir = join(workspaceDir, "specs");

    const result = await syncIdleResourceUpdates({
      workspaceDir,
      specsDir,
      projectTitle: "Sushi Kitties",
      currentSpecsHash: "old",
      currentAssetsHash: "assets",
      checkSpecChangesFn: async () => changedSpecs("requires_loop_work"),
      checkAssetChangesFn: async () => null,
    });

    expect(result.pendingLoopWork).toBe(true);
  });

  it("does not let a latest no-work artifact mask older backlog loop work", async () => {
    const workspaceDir = makeTempWorkspace();
    const specsDir = join(workspaceDir, "specs");

    const result = await syncIdleResourceUpdates({
      workspaceDir,
      specsDir,
      projectTitle: "Sushi Kitties",
      currentSpecsHash: "old",
      currentAssetsHash: "assets",
      checkSpecChangesFn: async () => ({
        hash: "new-backlog",
        specs: [{
          id: "spec-1",
          slug: "Product Spec",
          content: "# Product Spec\n\nCurrent truth.",
          hash: "content-hash",
          acceptedArtifact: acceptedArtifact("no_loop_work"),
          acceptedArtifactBacklog: [
            { acceptedArtifact: acceptedArtifact("requires_loop_work") },
            { acceptedArtifact: acceptedArtifact("no_loop_work") },
          ],
        }],
      }),
      checkAssetChangesFn: async () => null,
    });

    expect(result.pendingLoopWork).toBe(true);
  });

  it("keeps plain markdown spec changes as loop work", async () => {
    const workspaceDir = makeTempWorkspace();
    const specsDir = join(workspaceDir, "specs");

    const result = await syncIdleResourceUpdates({
      workspaceDir,
      specsDir,
      projectTitle: "Plain Project",
      currentSpecsHash: "old",
      currentAssetsHash: "assets",
      checkSpecChangesFn: async () => changedSpecs(),
      checkAssetChangesFn: async () => null,
    });

    expect(result.pendingLoopWork).toBe(true);
  });
});
