/**
 * RA-083: Spec file management for runner.
 * Writes specs from governance to workspace, polls for changes.
 */

import { createHash } from "crypto";
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { fetchSpecs, type SpecsData } from "./api.js";

export interface SpecFile {
  id: string;
  slug: string;
  content: string;
  hash: string;
  inputHash?: string;
  currentVersion?: unknown;
  source?: unknown;
  acceptedArtifact?: unknown;
  acceptedArtifactBacklog?: unknown[];
  metadataHash?: string;
}

export interface SpecInputManifest {
  schemaVersion: 1;
  aggregateHash: string;
  specs: Array<{
    id: string;
    slug: string;
    hash: string;
    inputHash?: string;
    currentVersion?: unknown;
    source?: unknown;
    acceptedArtifact?: unknown;
    acceptedArtifactBacklog?: unknown[];
    metadataHash?: string;
  }>;
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function definedObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => (
      entry !== undefined
        && entry !== null
        && !(Array.isArray(entry) && entry.length === 0)
    )),
  ) as T;
}

export function buildSpecInputManifest(specs: SpecFile[]): SpecInputManifest {
  const items = specs.map((spec) => definedObject({
    id: spec.id,
    slug: spec.slug,
    hash: spec.hash,
    inputHash: spec.inputHash,
    currentVersion: spec.currentVersion,
    source: spec.source,
    acceptedArtifact: spec.acceptedArtifact,
    acceptedArtifactBacklog: spec.acceptedArtifactBacklog,
    metadataHash: spec.metadataHash,
  }));

  return {
    schemaVersion: 1,
    aggregateHash: md5(items.map((spec) => spec.inputHash ?? spec.hash).join("")),
    specs: items,
  };
}

export function writeSpecFiles(specsDir: string, specs: SpecFile[], projectTitle?: string): void {
  mkdirSync(specsDir, { recursive: true });

  // Clean existing spec files
  try {
    for (const f of readdirSync(specsDir)) {
      if (f.endsWith(".md")) {
        unlinkSync(join(specsDir, f));
      }
    }
  } catch {
    // Directory might not exist yet
  }

  // Write project title as first spec file if provided
  if (projectTitle) {
    writeFileSync(join(specsDir, "000-project.md"), `# Project: ${projectTitle}\n`);
  }

  // Write new spec files
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const slug = s.slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const filename = `${String(i + 1).padStart(3, "0")}-${slug}-${s.id.slice(-4)}.md`;
    writeFileSync(join(specsDir, filename), s.content, "utf-8");
  }
}

export function writeSpecInputManifest(workspaceDir: string, specs: SpecFile[]): void {
  const arenaDir = join(workspaceDir, ".arena");
  mkdirSync(arenaDir, { recursive: true });
  writeFileSync(
    join(arenaDir, "spec-input.json"),
    `${JSON.stringify(buildSpecInputManifest(specs), null, 2)}\n`,
    "utf-8",
  );
}

export function buildCombinedSpecContent(specs: SpecFile[], projectTitle?: string): string {
  const titleHeader = projectTitle ? `# Project: ${projectTitle}\n\n` : "";
  return titleHeader + specs.map((s) => `# ${s.slug}\n\n${s.content}`).join("\n\n---\n\n");
}

export function syncSpecWorkspace(
  workspaceDir: string,
  specsDir: string,
  specs: SpecFile[],
  projectTitle?: string,
): void {
  writeSpecFiles(specsDir, specs, projectTitle);
  writeFileSync(join(workspaceDir, "spec.md"), buildCombinedSpecContent(specs, projectTitle), "utf-8");
  writeSpecInputManifest(workspaceDir, specs);
}

/**
 * Poll governance for spec changes. Returns new specs if hash changed, null otherwise.
 */
export async function checkSpecChanges(currentHash: string): Promise<SpecsData | null> {
  try {
    const data = await fetchSpecs();
    if (data.hash !== currentHash) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}
