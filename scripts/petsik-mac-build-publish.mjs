#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  assertAllowedPetsikProjectId,
  findSingleMacArtifact,
  parseAllowedPetsikProjectIds,
  parsePetsikMacBuildTag,
} from "./petsik-mac-build-publish-lib.mjs";

const config = {
  arenaBaseUrl: requireEnv("ARENA_ADMIN_BASE_URL").replace(/\/+$/, ""),
  adminSecret: requireEnv("ARENA_ADMIN_SECRET"),
  projectId: requireEnv("PETSIK_ARENA_PROJECT_ID"),
  repoDir: requireEnv("PETSIK_REPO_DIR"),
  tag: readArg("--tag") ?? process.env.PETSIK_BUILD_TAG,
  builderLabel: process.env.PETSIK_BUILDER_LABEL || "local-mac-builder",
  installCommand: process.env.PETSIK_INSTALL_COMMAND || "npm ci",
  buildCommand: process.env.PETSIK_BUILD_COMMAND || "npm run build",
  packageCommand: process.env.PETSIK_PACKAGE_COMMAND || "npm run dist:mac",
  artifactDir: process.env.PETSIK_ARTIFACT_DIR || "release",
};
config.allowedProjectIds = parseAllowedPetsikProjectIds(
  process.env.PETSIK_ALLOWED_ARENA_PROJECT_IDS,
);

let parsedTag = null;
try {
  parsedTag = parsePetsikMacBuildTag(config.tag);
  config.tag = parsedTag.tag;
  assertAllowedPetsikProjectId(config.projectId, config.allowedProjectIds);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

let workDir = null;
let commitSha = null;
try {
  commitSha = await git(["-C", config.repoDir, "rev-list", "-n", "1", config.tag]);
  workDir = await mkdtemp(path.join(tmpdir(), "petsik-mac-build-"));
  await run("git", ["clone", "--branch", config.tag, "--single-branch", config.repoDir, workDir]);
  await runShell(config.installCommand, workDir);
  await runShell(config.buildCommand, workDir);
  await runShell(config.packageCommand, workDir);

  const artifactPath = await findSingleMacArtifact(path.resolve(workDir, config.artifactDir));
  const artifactBytes = await readFile(artifactPath);
  const sha256 = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`;
  const filename = path.basename(artifactPath);

  await publish({
    status: "available",
    version: parsedTag.version,
    tag: config.tag,
    commitSha,
    filename,
    contentType: filename.toLowerCase().endsWith(".dmg")
      ? "application/x-apple-diskimage"
      : "application/zip",
    sha256,
    builderLabel: config.builderLabel,
    contentBase64: artifactBytes.toString("base64"),
  });
  console.log(JSON.stringify({ ok: true, status: "available", tag: config.tag, commitSha, filename, sha256 }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (parsedTag) {
    await publish({
      status: "build_failed",
      tag: config.tag,
      commitSha,
      builderLabel: config.builderLabel,
      failureSummary: message.slice(0, 1000),
    }).catch((publishError) => {
      console.error("Failed to publish build_failed manifest:", publishError);
    });
  }
  fail(message);
} finally {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function requireEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  fail(`Missing environment variable: ${names.join(" or ")}`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1]?.trim();
  return value || null;
}

async function git(args) {
  const output = await run("git", args, { capture: true });
  return output.trim();
}

async function runShell(command, cwd) {
  await run("/bin/zsh", ["-lc", command], { cwd });
}

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

async function publish(payload) {
  const response = await fetch(`${config.arenaBaseUrl}/api/admin/ctl/projects/${config.projectId}/release-artifacts/mac`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-arena-admin-secret": config.adminSecret,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Arena release publish failed: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
