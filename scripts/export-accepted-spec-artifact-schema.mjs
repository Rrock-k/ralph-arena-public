#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "../packages/contracts/node_modules/zod/index.js";
import {
  ACCEPTED_SPEC_ARTIFACT_REOPENED_FEEDBACK_MIN_REOPEN_COUNT,
  ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
  ACCEPTED_SPEC_ARTIFACT_SECRET_LIKE_VALUE_PATTERN_SOURCES,
  AcceptedSpecArtifactSchema,
} from "../packages/contracts/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultOut = path.join(root, "packages/contracts/generated/accepted-spec-artifact.schema.json");

function readArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildSchema() {
  const schema = z.toJSONSchema(AcceptedSpecArtifactSchema, { target: "draft-7" });
  applySourceEvidenceJsonSchemaRefinements(schema);
  schema.$id = `https://ralph-arena.local/schemas/${ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION}.json`;
  schema.title = "AcceptedSpecArtifact";
  schema.description = "Generated from @arena/contracts AcceptedSpecArtifactSchema. Do not edit by hand.";
  schema["x-arena-contract"] = {
    sourcePackage: "@arena/contracts",
    sourceSchema: "AcceptedSpecArtifactSchema",
    artifactSchemaVersion: ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
    generatedBy: "scripts/export-accepted-spec-artifact-schema.mjs",
    refinements: {
      secretLikeValuePatternSources: ACCEPTED_SPEC_ARTIFACT_SECRET_LIKE_VALUE_PATTERN_SOURCES,
      reopenedFeedback: {
        state: "reopened",
        minReopenCount: ACCEPTED_SPEC_ARTIFACT_REOPENED_FEEDBACK_MIN_REOPEN_COUNT,
      },
      sourceEvidence: {
        requiresQuoteOrIntent: true,
        sourceRefMustBeListedInDiffItemSourceRefs: true,
      },
    },
  };
  schema["x-arena-contract"].schemaSha256 = createHash("sha256")
    .update(stableStringify(schema))
    .digest("hex");
  return schema;
}

function applySourceEvidenceJsonSchemaRefinements(value) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach(applySourceEvidenceJsonSchemaRefinements);
    return;
  }

  const sourceEvidenceItems = value.properties?.sourceEvidence?.items;
  if (
    sourceEvidenceItems?.properties?.sourceRef
    && sourceEvidenceItems.properties.quote
    && sourceEvidenceItems.properties.intent
  ) {
    sourceEvidenceItems.anyOf = [
      { required: ["quote"] },
      { required: ["intent"] },
    ];
  }

  for (const entry of Object.values(value)) {
    applySourceEvidenceJsonSchemaRefinements(entry);
  }
}

function normalizeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const outPath = path.resolve(root, readArg("out") ?? defaultOut);
const check = process.argv.includes("--check");
const schema = buildSchema();
const output = normalizeJson(schema);

if (check) {
  const current = readFileSync(outPath, "utf8");
  if (current !== output) {
    console.error(`Generated accepted spec artifact schema is stale: ${path.relative(root, outPath)}`);
    console.error(`Run: npm --prefix packages/contracts run build && node scripts/export-accepted-spec-artifact-schema.mjs --out ${path.relative(root, outPath)}`);
    process.exit(1);
  }
  process.exit(0);
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, output);
console.log(`Wrote ${path.relative(root, outPath)}`);
