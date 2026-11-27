import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncIdleResourceUpdates } from "../dist/idle-resource-sync.js";

test("syncs idle asset updates without queuing loop work", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arena-idle-assets-"));
  const writes = [];

  try {
    const result = await syncIdleResourceUpdates({
      workspaceDir: workspace,
      specsDir: join(workspace, "specs"),
      projectTitle: "Sushi Kitties",
      currentSpecsHash: "specs-old",
      currentAssetsHash: "assets-old",
      checkSpecChangesFn: async () => null,
      syncSpecWorkspaceFn: () => {
        throw new Error("spec sync should not run");
      },
      checkAssetChangesFn: async () => ({
        hash: "assets-new",
        assets: [
          {
            id: "asset-1",
            path: "assets/telegram/live-proof/bridge-note.txt",
            contentBase64: Buffer.from("RA-270 LIVE PROOF\n").toString("base64"),
            contentType: "text/plain; charset=utf-8",
            sha256: "sha-1",
          },
        ],
      }),
      writeAssetFilesFn: async (_workspaceDir, assets) => {
        writes.push(assets.map((asset) => asset.path));
      },
    });

    assert.equal(result.currentSpecsHash, "specs-old");
    assert.equal(result.currentAssetsHash, "assets-new");
    assert.equal(result.pendingLoopWork, false);
    assert.deepEqual(writes, [["assets/telegram/live-proof/bridge-note.txt"]]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("queues loop work when idle spec updates arrive and also syncs assets", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "arena-idle-both-"));
  const specSyncs = [];
  const assetWrites = [];

  try {
    const result = await syncIdleResourceUpdates({
      workspaceDir: workspace,
      specsDir: join(workspace, "specs"),
      projectTitle: "Desk Garden",
      currentSpecsHash: "specs-old",
      currentAssetsHash: "assets-old",
      checkSpecChangesFn: async () => ({
        hash: "specs-new",
        specs: [
          {
            filename: "spec.md",
            content: "# Desk Garden\n",
          },
        ],
      }),
      syncSpecWorkspaceFn: (workspaceDir, specsDir, specs, projectTitle) => {
        specSyncs.push({ workspaceDir, specsDir, specs, projectTitle });
      },
      checkAssetChangesFn: async () => ({
        hash: "assets-new",
        assets: [
          {
            id: "asset-2",
            path: "assets/reference/palette.txt",
            contentBase64: Buffer.from("sage").toString("base64"),
            contentType: "text/plain; charset=utf-8",
            sha256: "sha-2",
          },
        ],
      }),
      writeAssetFilesFn: async (_workspaceDir, assets) => {
        assetWrites.push(assets.map((asset) => asset.path));
      },
    });

    assert.equal(result.currentSpecsHash, "specs-new");
    assert.equal(result.currentAssetsHash, "assets-new");
    assert.equal(result.pendingLoopWork, true);
    assert.equal(specSyncs.length, 1);
    assert.equal(specSyncs[0].projectTitle, "Desk Garden");
    assert.deepEqual(assetWrites, [["assets/reference/palette.txt"]]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
