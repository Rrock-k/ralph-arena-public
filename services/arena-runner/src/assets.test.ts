import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { writeAssetFiles } from "./assets.js";
import type { AssetItem } from "./api.js";

function tempWorkspace(t: any): string {
  const dir = mkdtempSync(join(tmpdir(), "arena-runner-assets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function materializeAsset(workspaceDir: string, path: string, contents: string): AssetItem {
  const destination = join(workspaceDir, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
  return {
    id: `id-${path}`,
    path,
    sha256: createHash("sha256").update(Buffer.from(contents)).digest("hex"),
    sizeBytes: Buffer.byteLength(contents),
    contentType: "application/octet-stream",
  } as AssetItem;
}

function readManifest(workspaceDir: string): { assets: AssetItem[]; retiredPaths: string[] } {
  return JSON.parse(readFileSync(join(workspaceDir, ".arena/assets-manifest.json"), "utf-8"));
}

test("writeAssetFiles declares assets it deleted so the loop can commit the deletion", async (t) => {
  const workspace = tempWorkspace(t);
  const superseded = materializeAsset(workspace, "assets/telegram/chat-1/msg-89/Room_00.glb", "old room");
  const kept = materializeAsset(workspace, "assets/telegram/chat-1/msg-56/M_Road.glb", "road");
  await writeAssetFiles(workspace, [superseded, kept]);

  await writeAssetFiles(workspace, [kept]);

  assert.equal(existsSync(join(workspace, superseded.path)), false);
  const manifest = readManifest(workspace);
  assert.deepEqual(manifest.assets.map((asset) => asset.path), [kept.path]);
  assert.deepEqual(manifest.retiredPaths, [superseded.path]);
});

test("writeAssetFiles keeps retired declarations until the path returns to the accepted set", async (t) => {
  const workspace = tempWorkspace(t);
  const first = materializeAsset(workspace, "assets/telegram/chat-1/msg-1/first.glb", "first");
  const second = materializeAsset(workspace, "assets/telegram/chat-1/msg-2/second.glb", "second");
  await writeAssetFiles(workspace, [first, second]);
  await writeAssetFiles(workspace, [second]);

  await writeAssetFiles(workspace, []);

  // A deletion the loop has not delivered yet must survive later syncs.
  assert.deepEqual(readManifest(workspace).retiredPaths, [first.path, second.path]);

  materializeAsset(workspace, first.path, "first");
  await writeAssetFiles(workspace, [first]);

  assert.deepEqual(readManifest(workspace).retiredPaths, [second.path]);
});

test("writeAssetFiles does not claim a deletion it refused to perform", async (t) => {
  const workspace = tempWorkspace(t);
  const asset = materializeAsset(workspace, "assets/telegram/chat-1/msg-3/edited.glb", "original");
  await writeAssetFiles(workspace, [asset]);
  writeFileSync(join(workspace, asset.path), "edited by the agent");

  await writeAssetFiles(workspace, []);

  assert.equal(existsSync(join(workspace, asset.path)), true);
  assert.deepEqual(readManifest(workspace).retiredPaths, []);
});
