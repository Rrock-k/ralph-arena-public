import { readdir } from "node:fs/promises";
import path from "node:path";

export const PETSIK_MAC_BUILD_TAG_RE = /^mac-build\/petsik-v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?)$/;
const MAC_ARTIFACT_EXT_RE = /\.(zip|dmg)$/i;

export function parsePetsikMacBuildTag(value) {
  const tag = value?.trim();
  const match = tag?.match(PETSIK_MAC_BUILD_TAG_RE);
  if (!tag || !match) {
    throw new Error(`Tag must match ${PETSIK_MAC_BUILD_TAG_RE.source}`);
  }
  return {
    tag,
    version: match[1],
  };
}

export function parseAllowedPetsikProjectIds(value) {
  const ids = `${value ?? ""}`
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids;
}

export function assertAllowedPetsikProjectId(projectId, allowedProjectIds) {
  if (allowedProjectIds.length === 0) {
    throw new Error("PETSIK_ALLOWED_ARENA_PROJECT_IDS must include the Petsik Arena project id");
  }
  if (!allowedProjectIds.includes(projectId)) {
    throw new Error("Petsik Mac builder project is not allowlisted");
  }
}

export async function findSingleMacArtifact(root) {
  const files = await listFiles(root);
  const artifacts = files.filter((file) => MAC_ARTIFACT_EXT_RE.test(file));
  if (artifacts.length !== 1) {
    throw new Error(`Expected exactly one .zip or .dmg artifact in ${root}, found ${artifacts.length}`);
  }
  return artifacts[0];
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
