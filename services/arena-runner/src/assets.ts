/**
 * RA-222: Project asset file management for runner.
 *
 * Governance owns the asset manifest. Runner materializes each asset at
 * /workspace/{asset.path}, e.g. /workspace/assets/models/tree.glb.
 */

import { createHash } from "crypto";
import { dirname, resolve, sep } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { downloadAsset, fetchAssets, type AssetItem, type AssetsData } from "./api.js";

type ManagedAssetManifest = {
  assets: AssetItem[];
  /**
   * Asset paths this runner deleted from the workspace because the accepted
   * manifest dropped them. The loop needs them declared to commit the deletion:
   * a deleted-but-tracked file the loop does not own reads as ambiguous
   * pre-existing source and blocks the pre-agent source evidence guard for good.
   */
  retiredPaths: string[];
};

const MANIFEST_PATH = ".arena/assets-manifest.json";

export async function writeAssetFiles(workspaceDir: string, assets: AssetItem[]): Promise<void> {
  const previous = readManagedManifest(workspaceDir);
  const nextByPath = new Map(assets.map((asset) => [asset.path, asset]));
  const retiredPaths = new Set(previous.retiredPaths);

  for (const asset of previous.assets) {
    if (nextByPath.has(asset.path)) continue;
    if (removeManagedAsset(workspaceDir, asset)) {
      retiredPaths.add(asset.path);
    }
  }

  for (const asset of assets) {
    const destination = resolveWorkspaceAssetPath(workspaceDir, asset.path);
    const currentHash = existsSync(destination) ? sha256(readFileSync(destination)) : null;
    if (currentHash === asset.sha256) continue;

    const bytes = await downloadAsset(asset.id);
    const downloadedHash = sha256(bytes);
    if (downloadedHash !== asset.sha256) {
      throw new Error(`Asset ${asset.path} checksum mismatch: expected ${asset.sha256}, got ${downloadedHash}`);
    }

    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    console.log(`[runner] Wrote asset ${asset.path} (${bytes.byteLength} bytes)`);
  }

  writeManagedManifest(workspaceDir, {
    assets,
    // A path that came back into the accepted set is materialized again, so it
    // is no longer a pending deletion.
    retiredPaths: [...retiredPaths].filter((path) => !nextByPath.has(path)).sort(),
  });
}

/**
 * Poll governance for asset manifest changes. Returns new manifest if hash changed.
 */
export async function checkAssetChanges(currentHash: string): Promise<AssetsData | null> {
  try {
    const data = await fetchAssets();
    if (data.hash !== currentHash) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function readManagedManifest(workspaceDir: string): ManagedAssetManifest {
  const manifestPath = resolveWorkspacePath(workspaceDir, MANIFEST_PATH);
  if (!existsSync(manifestPath)) return { assets: [], retiredPaths: [] };
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as ManagedAssetManifest;
    return {
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      retiredPaths: Array.isArray(parsed.retiredPaths)
        ? parsed.retiredPaths.filter((path): path is string => typeof path === "string" && !!path)
        : [],
    };
  } catch {
    return { assets: [], retiredPaths: [] };
  }
}

function writeManagedManifest(workspaceDir: string, manifest: ManagedAssetManifest): void {
  const manifestPath = resolveWorkspacePath(workspaceDir, MANIFEST_PATH);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/** Returns true when this runner deleted the file and owes the loop a deletion. */
function removeManagedAsset(workspaceDir: string, asset: AssetItem): boolean {
  const destination = resolveWorkspaceAssetPath(workspaceDir, asset.path);
  if (!existsSync(destination)) return false;

  const currentHash = sha256(readFileSync(destination));
  if (currentHash !== asset.sha256) {
    console.log(`[runner] Keeping modified asset ${asset.path}; manifest no longer tracks it`);
    return false;
  }

  rmSync(destination, { force: true });
  console.log(`[runner] Removed asset ${asset.path}`);
  return true;
}

function resolveWorkspaceAssetPath(workspaceDir: string, assetPath: string): string {
  if (!assetPath.startsWith("assets/")) {
    throw new Error(`Invalid asset path ${assetPath}: must start with assets/`);
  }
  return resolveWorkspacePath(workspaceDir, assetPath);
}

function resolveWorkspacePath(workspaceDir: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`Invalid workspace-relative path: ${relativePath}`);
  }
  const root = resolve(workspaceDir);
  const resolved = resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Workspace path escaped root: ${relativePath}`);
  }
  return resolved;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
