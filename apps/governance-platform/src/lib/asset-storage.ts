import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ASSET_ROOT = path.resolve(process.cwd(), "..", "..", "runtime", "project-assets");

export function getAssetStorageRoot(): string {
  return path.resolve(process.env.ARENA_PROJECT_ASSETS_ROOT || DEFAULT_ASSET_ROOT);
}

export async function saveAssetBytes(assetId: string, filename: string, buffer: Buffer): Promise<string> {
  const storageKey = `${assetId}/${filename}`;
  const absolutePath = resolveStorageKey(storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  return storageKey;
}

export async function readAssetBytes(storageKey: string): Promise<Buffer> {
  return readFile(resolveStorageKey(storageKey));
}

export async function deleteAssetBytes(storageKey: string): Promise<void> {
  const absolutePath = resolveStorageKey(storageKey);
  await rm(absolutePath, { force: true });
  await rm(path.dirname(absolutePath), { recursive: true, force: true });
}

function resolveStorageKey(storageKey: string): string {
  if (!storageKey || path.isAbsolute(storageKey) || storageKey.split(/[\\/]+/).includes("..")) {
    throw new Error("Invalid asset storage key");
  }

  const root = getAssetStorageRoot();
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Asset storage key escaped storage root");
  }
  return resolved;
}
