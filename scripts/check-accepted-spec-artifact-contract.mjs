#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

const root = repoRoot();
const verbose = process.argv.includes("--verbose");

const currentBoundaryFiles = [
  "apps/governance-platform/prisma/schema.prisma",
  "apps/governance-platform/src/lib/runner-specs.ts",
  "apps/governance-platform/src/lib/spec-artifact-audit.ts",
  "apps/governance-platform/src/lib/project-interaction.ts",
  "apps/governance-platform/src/lib/tg-spec-import-metadata.ts",
  "apps/governance-platform/src/lib/project-update-outbox.ts",
  "apps/governance-platform/src/app/api/internal/tg-spec/projects/[projectId]/import/route.ts",
  "apps/governance-platform/src/app/api/internal/projects/[id]/init/route.ts",
  "apps/governance-platform/src/app/api/internal/projects/[id]/specs/route.ts",
  "services/arena-runner/src/specs.ts",
  "services/arena-ctl/src/governance-client.ts",
  "services/arena-ctl/src/tools/spec-artifact-audit.ts",
  "packages/loops/ralph-runtime/src/config/types.ts",
  "packages/loops/ralph-runtime/src/feedback/spec-input.ts",
  "packages/loops/ralph-runtime/src/planning/planner.ts",
  "docs/contracts/ralph-feedback-evidence-contract.md",
  "docs/loops/contract.md",
  "docs/contracts/telegram-project-manager-contract.md",
  ".codex/skills/ralph-arena-operator/SKILL.md",
  ".codex/skills/ralph-arena-operating-principles/SKILL.md",
];

const projectReadSideVocabularyFiles = [
  "apps/governance-platform/src/components/project-interaction/ProjectInteractionBlocks.tsx",
  "docs/contracts/telegram-project-manager-contract.md",
  ".codex/skills/ralph-arena-operating-principles/SKILL.md",
];

const siblingProjectReadSideVocabularyFiles = [
  "../tg-spec/apps/evolution-ui/src/pages/arena-project-page.tsx",
  "../tg-spec/apps/evolution-ui/src/lib/arena-interaction-types.ts",
  "../tg-spec/docs/backlog/task-manager.md",
  "../tg-spec/work/plans/ev-041-arena-project-webapp/plan.md",
];

const legacyPatterns = [
  "acceptedDelta",
  "externalProvenance",
  "sourceProvenance",
  "ralphDirective",
  "expectedRalphHandling",
  "accepted_delta",
  "deltaStatus",
  "deltaHash",
  "deltaItemCount",
  "deltaItemIds",
  "valid_legacy_v2_metadata",
  "legacy_v2_accepted_delta",
  "accepted_artifact_v1_in_legacy_json_field",
  "launch_or_resume_legacy_markdown",
];

const projectReadSideLegacyPatterns = [
  "Ralph tasks",
  "Ralph task tab",
  "Задачи Ralph",
];

const requiredText = [
  {
    file: "apps/governance-platform/prisma/schema.prisma",
    text: "acceptedArtifact",
    reason: "SpecVersion must persist structured product truth as acceptedArtifact.",
  },
  {
    file: "services/arena-runner/src/specs.ts",
    text: "acceptedArtifact",
    reason: "Runner manifest must expose acceptedArtifact.",
  },
  {
    file: "packages/loops/ralph-runtime/src/feedback/spec-input.ts",
    text: "readAcceptedArtifactFeedbackContext",
    reason: "Ralph must consume acceptedArtifact, not accepted-delta metadata.",
  },
  {
    file: "docs/contracts/accepted-spec-artifact-contract.md",
    text: "SpecVersion.acceptedArtifact",
    reason: "Canonical docs must name the storage boundary.",
  },
];

const generatedSchemaFile = "packages/contracts/generated/accepted-spec-artifact.schema.json";
const siblingTgSpecPackageFile = "../tg-spec/apps/evolution-mvp/package.json";
const siblingTgSpecLegacyBridgeFiles = [
  "../tg-spec/apps/evolution-mvp/lib/arena-accepted-spec-artifact.schema.json",
  "../tg-spec/apps/evolution-mvp/lib/arena-accepted-spec-artifact-contract.mjs",
];

function read(rel) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

const errors = [];

for (const file of currentBoundaryFiles) {
  const source = read(file);
  if (source == null) {
    errors.push(`${file} is missing from accepted spec artifact contract check`);
    continue;
  }

  for (const pattern of legacyPatterns) {
    if (source.includes(pattern)) {
      errors.push(`${file} still contains legacy accepted-spec vocabulary "${pattern}"`);
    }
  }
}

for (const { file, text, reason } of requiredText) {
  const source = read(file);
  if (source == null || !source.includes(text)) {
    errors.push(`${file} is missing "${text}". ${reason}`);
  }
}

for (const file of projectReadSideVocabularyFiles) {
  const source = read(file);
  if (source == null) {
    errors.push(`${file} is missing from project read-side vocabulary check`);
    continue;
  }

  for (const pattern of projectReadSideLegacyPatterns) {
    if (source.includes(pattern)) {
      errors.push(`${file} still exposes "${pattern}" as project-facing product vocabulary`);
    }
  }
}

for (const file of siblingProjectReadSideVocabularyFiles) {
  const abs = path.resolve(root, file);
  if (!existsSync(abs)) continue;
  const source = readFileSync(abs, "utf8");
  for (const pattern of projectReadSideLegacyPatterns) {
    if (source.includes(pattern)) {
      errors.push(`${file} still exposes "${pattern}" as project-facing product vocabulary`);
    }
  }
}

const generatedSchema = read(generatedSchemaFile);
if (generatedSchema == null) {
  errors.push(`${generatedSchemaFile} is missing. Run: npm --prefix packages/contracts run export:accepted-spec-schema`);
} else if (!generatedSchema.includes("\"artifactSchemaVersion\": \"ra-287.accepted-spec-artifact.v1\"")) {
  errors.push(`${generatedSchemaFile} does not name the current accepted spec artifact schema version.`);
} else {
  try {
    const parsedSchema = JSON.parse(generatedSchema);
    const refinements = parsedSchema?.["x-arena-contract"]?.refinements;
    if (!Array.isArray(refinements?.secretLikeValuePatternSources) || refinements.secretLikeValuePatternSources.length === 0) {
      errors.push(`${generatedSchemaFile} is missing generated secret-like value refinement metadata.`);
    }
    if (!Number.isInteger(refinements?.reopenedFeedback?.minReopenCount)) {
      errors.push(`${generatedSchemaFile} is missing generated reopened feedback refinement metadata.`);
    }
  } catch (error) {
    errors.push(`${generatedSchemaFile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const siblingPackageAbs = path.resolve(root, siblingTgSpecPackageFile);
if (existsSync(siblingPackageAbs)) {
  try {
    const siblingPackage = JSON.parse(readFileSync(siblingPackageAbs, "utf8"));
    const dependency =
      siblingPackage?.dependencies?.["@arena/contracts"] ??
      siblingPackage?.devDependencies?.["@arena/contracts"];
    if (dependency !== "file:../../../agents-arena/packages/contracts") {
      errors.push(
        `${siblingTgSpecPackageFile} must depend on @arena/contracts via file:../../../agents-arena/packages/contracts.`,
      );
    }
  } catch (error) {
    errors.push(`${siblingTgSpecPackageFile} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const file of siblingTgSpecLegacyBridgeFiles) {
    const abs = path.resolve(root, file);
    if (existsSync(abs)) {
      errors.push(`${file} must not exist. tg-spec consumes @arena/contracts directly, not a copied schema bridge.`);
    }
  }
}

if (errors.length > 0) {
  console.error("Accepted spec artifact contract check failed:");
  for (const error of errors) console.error(`- ${error}`);
  console.error("");
  console.error("Legacy v2 accepted-delta vocabulary is allowed only in historical tests/work notes, not current runtime surfaces.");
  process.exit(1);
}

if (verbose) {
  console.log(`Accepted spec artifact contract OK: ${currentBoundaryFiles.length} current boundary files checked.`);
}
