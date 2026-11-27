import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RELEASE_ROOT = path.resolve(process.cwd(), "..", "..", "runtime", "project-release-artifacts");

export function getProjectReleaseStorageRoot(): string {
  return path.resolve(process.env.ARENA_PROJECT_RELEASES_ROOT || DEFAULT_RELEASE_ROOT);
}

export async function saveProjectReleaseBytes(
  artifactId: string,
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const storageKey = `${artifactId}/${filename}`;
  const absolutePath = resolveProjectReleaseStorageKey(storageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  return storageKey;
}

export async function readProjectReleaseBytes(storageKey: string): Promise<Buffer> {
  return readFile(resolveProjectReleaseStorageKey(storageKey));
}

function resolveProjectReleaseStorageKey(storageKey: string): string {
  if (!storageKey || path.isAbsolute(storageKey) || storageKey.split(/[\\/]+/).includes("..")) {
    throw new Error("Invalid release artifact storage key");
  }

  const root = getProjectReleaseStorageRoot();
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Release artifact storage key escaped storage root");
  }
  return resolved;
}
