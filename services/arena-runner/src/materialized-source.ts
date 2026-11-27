/**
 * Runner-materialized product-source declaration.
 *
 * The runner writes a few files directly into product source — currently the
 * platform contract stamp in `CLAUDE.md` (RA-247). Those files are not covered
 * by `.arena/spec-input.json` (specs) or `.arena/assets-manifest.json` (assets),
 * so the loop had no way to know they are platform-written. An undeclared
 * platform-written file looks like ambiguous pre-existing source to the loop's
 * pre-agent source evidence guard, which blocks the executor agent for good.
 *
 * This manifest is the explicit contract: runner declares which product-source
 * paths it materialized, loop delivers them before calling the agent.
 */

import { dirname, resolve, sep } from "path";
import { mkdirSync, writeFileSync } from "fs";

export const MATERIALIZED_SOURCE_MANIFEST_RELATIVE_PATH = ".arena/materialized-source.json";

export interface MaterializedSourceManifest {
  paths: string[];
}

/**
 * Paths the runner may declare are product source, not platform channel state.
 * `.arena/` and `.ralph/` are runtime-owned and git-ignored; declaring them
 * would ask the loop to commit platform state as product truth.
 */
const REJECTED_PATH_PREFIXES = [".arena/", ".ralph/", ".git/"];

export function writeMaterializedSourceManifest(
  workspaceDir: string,
  paths: string[],
): MaterializedSourceManifest {
  const declared = [...new Set(paths.map((path) => normalizeDeclaredPath(path)))].sort();
  const manifest: MaterializedSourceManifest = { paths: declared };
  const manifestPath = resolveWorkspacePath(workspaceDir, MATERIALIZED_SOURCE_MANIFEST_RELATIVE_PATH);

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

function normalizeDeclaredPath(path: string): string {
  const normalized = path.trim().replaceAll("\\", "/");
  if (!normalized) {
    throw new Error("Materialized source path must not be empty");
  }
  if (normalized.startsWith("/")) {
    throw new Error(`Materialized source path must be workspace-relative: ${path}`);
  }
  if (normalized.split("/").includes("..")) {
    throw new Error(`Materialized source path must not traverse upwards: ${path}`);
  }
  for (const prefix of REJECTED_PATH_PREFIXES) {
    if (normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)) {
      throw new Error(`Materialized source path must be product source, not ${prefix}: ${path}`);
    }
  }
  return normalized;
}

function resolveWorkspacePath(workspaceDir: string, relativePath: string): string {
  const root = resolve(workspaceDir);
  const resolved = resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Workspace path escaped root: ${relativePath}`);
  }
  return resolved;
}
