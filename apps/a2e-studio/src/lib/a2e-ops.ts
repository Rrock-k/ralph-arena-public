import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCommitBlocksFromSelection, formatCommitScopeSummary } from "@/lib/commit-scope";
import type { CommitEntry, Manifest, ManifestDraft, PrepData, RepoSnapshot, ScenarioOption } from "@/lib/schema";

const APP_ROOT = process.cwd();
const REPO_ROOT = path.resolve(APP_ROOT, "../..");
const MANIFEST_DIR = path.join(REPO_ROOT, "a2e", "state", "manifests");
const DEFAULT_REPOS = [
  { name: "agents-arena", path: REPO_ROOT },
  { name: "raleph", path: path.resolve(REPO_ROOT, "../raleph") },
  { name: "sympho", path: path.resolve(REPO_ROOT, "../sympho") },
];
const BACKLOG_FILES = [
  path.join(REPO_ROOT, "docs", "backlog", "ralph-arena.md"),
  path.join(REPO_ROOT, "docs", "backlog", "task-manager.md"),
];

export const DEFAULT_REVIEW_TARGETS = ["RA-108", "RA-149", "RA-152", "RA-153", "RA-155"] as const;

export const DEFAULT_SCENARIOS: ScenarioOption[] = [
  {
    id: "playwright-auth-ui",
    label: "Auth UI",
    description: "Run e2e-auth-ui.spec.ts as supporting proof for auth and role entry.",
    lane: "lane_1",
    defaultSelected: true,
  },
  {
    id: "playwright-proposal-flow",
    label: "Proposal Flow",
    description: "Run e2e-proposal-flow.spec.ts for community proposal and vote surfaces.",
    lane: "lane_1",
    defaultSelected: true,
  },
  {
    id: "playwright-admin-budget",
    label: "Admin Budget Flow",
    description: "Run e2e-admin-budget-flow.spec.ts for budget/admin lifecycle checks.",
    lane: "lane_1",
    defaultSelected: true,
  },
  {
    id: "playwright-runtime-projects",
    label: "Runtime Projects",
    description: "Run e2e-runtime-projects.spec.ts for runtime-backed project paths.",
    lane: "lane_1",
    defaultSelected: true,
  },
  {
    id: "playwright-platform-regression",
    label: "Platform Regression",
    description: "Run e2e-platform-regression.spec.ts for cross-surface regression.",
    lane: "lane_1",
    defaultSelected: true,
  },
  {
    id: "local-loop-matrix",
    label: "Local Loop Matrix",
    description: "Manual/UI verification of direct, ralph, and sympho loop selection and launch paths.",
    lane: "lane_3",
    defaultSelected: true,
  },
  {
    id: "feature-ledger-manual-walkthrough",
    label: "Manual Feature Walkthrough",
    description: "Manual-first walkthrough of user-facing features with fresh evidence.",
    lane: "lane_3",
    defaultSelected: true,
  },
  {
    id: "vps-sympho-smoke",
    label: "Sympho VPS Smoke",
    description: "Single VPS smoke for Sympho after local baseline is green.",
    lane: "lane_2",
    defaultSelected: false,
  },
];

function runGit(repoPath: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function compactInstruction(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function extractTaskRefs(subject: string) {
  return Array.from(subject.matchAll(/\b(?:RA|TM)-\d+\b/g), (match) => match[0]);
}

function readTaskCatalog() {
  const catalog = new Map<string, { title: string; status: string }>();
  const headingPattern = /^#{2,6}\s+\[([A-Z ]+)\]\s+((?:RA|TM)-\d+):\s+(.+)$/gm;

  for (const filePath of BACKLOG_FILES) {
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    for (const match of Array.from(content.matchAll(headingPattern))) {
      const [, status, id, title] = match;
      if (!catalog.has(id)) {
        catalog.set(id, {
          status,
          title: title.trim(),
        });
      }
    }
  }

  return catalog;
}

export function readRecentCommits(limit: number, skip = 0): CommitEntry[] {
  const taskCatalog = readTaskCatalog();
  const raw = runGit(REPO_ROOT, [
    "log",
    `-n${limit}`,
    `--skip=${skip}`,
    "--date=iso-strict",
    "--pretty=format:%H%x09%h%x09%an%x09%ad%x09%s",
  ]);
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, authorName, authoredAt, ...subjectParts] = line.split("\t");
      const subject = subjectParts.join("\t");
      const taskRefs = extractTaskRefs(subject);
      const primaryTaskId = taskRefs[0] ?? null;
      const primaryTask = primaryTaskId
        ? (() => {
            const task = taskCatalog.get(primaryTaskId);
            return {
              id: primaryTaskId,
              title: task?.title ?? null,
              status: task?.status ?? null,
            };
          })()
        : null;
      const subjectCore =
        primaryTaskId && subject.startsWith(`${primaryTaskId}:`)
          ? subject.slice(primaryTaskId.length + 1).trim()
          : subject;
      return {
        sha,
        shortSha,
        authorName,
        authoredAt,
        subject,
        subjectCore,
        taskRefs,
        primaryTask,
      };
    });
}

function readRepoSnapshot(repo: { name: string; path: string }): RepoSnapshot {
  try {
    const headInfo = runGit(repo.path, ["log", "-1", "--pretty=%H%x09%h%x09%s"]);
    const [headSha, headShaShort, ...titleParts] = headInfo.split("\t");
    const branch = runGit(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const dirtyOutput = runGit(repo.path, ["status", "--short"]);
    const dirtyEntries = dirtyOutput
      ? dirtyOutput.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    return {
      name: repo.name,
      path: repo.path,
      exists: true,
      clean: dirtyEntries.length === 0,
      reason: dirtyEntries.length === 0 ? null : "dirty",
      branch: branch || null,
      headSha: headSha || null,
      headShaShort: headShaShort || null,
      headTitle: titleParts.join("\t") || null,
    };
  } catch (error) {
    return {
      name: repo.name,
      path: repo.path,
      exists: false,
      clean: false,
      reason: error instanceof Error ? error.message : String(error),
      branch: null,
      headSha: null,
      headShaShort: null,
      headTitle: null,
    };
  }
}

export function getPrepData(): PrepData {
  return {
    recentCommits: readRecentCommits(200),
    repos: DEFAULT_REPOS.map(readRepoSnapshot),
    reviewTargets: [...DEFAULT_REVIEW_TARGETS],
    scenarioOptions: DEFAULT_SCENARIOS,
  };
}

export function buildManifest(draft: ManifestDraft, prep: PrepData, manifestId: string): Manifest {
  const commitMap = new Map(prep.recentCommits.map((commit) => [commit.sha, commit]));
  const selectedCommits = draft.selectedCommitShas
    .map((sha) => commitMap.get(sha))
    .filter((commit): commit is CommitEntry => Boolean(commit));
  const selectedBlocks = buildCommitBlocksFromSelection(
    selectedCommits.map((commit) => commit.sha),
    prep.recentCommits,
  );
  const selectedScenarios = prep.scenarioOptions.filter((scenario) => draft.selectedScenarioIds.includes(scenario.id));
  return {
    version: 1,
    manifestId,
    createdAt: new Date().toISOString(),
    source: "a2e-studio",
    batchLabel: draft.batchLabel.trim(),
    commitScope: {
      mode: selectedBlocks.length <= 1 ? "contiguous_range" : "explicit_blocks",
      selectedCommits,
      selectedBlocks,
      baseSha: selectedBlocks.length === 1 ? selectedBlocks[0].baseSha : null,
      headSha: selectedBlocks.length === 1 ? selectedBlocks[0].headSha : null,
      customInstruction: compactInstruction(draft.customInstructions.commitScope),
    },
    scenarios: {
      selected: selectedScenarios,
      customInstruction: compactInstruction(draft.customInstructions.scenarios),
    },
    reviewTargets: {
      selected: draft.selectedReviewTargets,
      customInstruction: compactInstruction(draft.customInstructions.reviewTargets),
    },
    settings: draft.settings,
    customInstructions: draft.customInstructions,
    repos: prep.repos,
  };
}

export function buildPrompt(manifest: Manifest, manifestPath: string) {
  const reviewSummary =
    manifest.reviewTargets.selected.length > 0 ? manifest.reviewTargets.selected.join(", ") : "none selected";
  const scenarioSummary =
    manifest.scenarios.selected.length > 0
      ? manifest.scenarios.selected.map((scenario) => scenario.label).join(", ")
      : "none selected";
  const commitSummary = formatCommitScopeSummary(manifest.commitScope.selectedBlocks);
  const dirtyRepos = manifest.repos.filter((repo) => !repo.clean).map((repo) => repo.name);
  const summaryLines = [
    `- Batch: ${manifest.batchLabel}`,
    `- Commit scope: ${commitSummary}`,
    `- Review targets: ${reviewSummary}`,
    `- Scenarios: ${scenarioSummary}`,
    `- Mode: ${manifest.settings.localFullSweep ? "local full sweep" : "targeted run"}${manifest.settings.includeVpsSymphoSmoke ? " + Sympho VPS smoke" : ""}`,
    `- Freeze: ${manifest.settings.strictFreeze ? "strict" : manifest.settings.allowDirtyRepos ? "allow dirty repos" : "snapshot only"}`,
  ];
  if (dirtyRepos.length > 0) summaryLines.push(`- Current dirty repos: ${dirtyRepos.join(", ")}`);

  const operatorNotes = [
    manifest.customInstructions.commitScope,
    manifest.customInstructions.reviewTargets,
    manifest.customInstructions.scenarios,
    manifest.customInstructions.execution,
    manifest.customInstructions.environment,
    manifest.customInstructions.manualProof,
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  const commitScopeRules = [
    "- Commit scope is defined only by manifest.commitScope.selectedBlocks and selectedCommits.",
    "- Do not silently expand commit review to provenance..HEAD unless the operator selected that whole range.",
    "- If there are multiple blocks, review and verify each selected block explicitly.",
  ];

  if (manifest.settings.promptStyle === "minimal") {
    return `Read and execute this manifest exactly:\n- ${manifestPath}\n\nRules:\n${commitScopeRules.join("\n")}\n- Previous runs and existing checklist marks are context only, not proof.\n- Re-prove the selected scope in this run.\n- Use run-state, artifacts, cleanup, and final report.\n- If a user-facing feature was not manually observed, mark it not proven.\n`;
  }

  const selectedBlocksSection =
    manifest.commitScope.selectedBlocks.length > 0
      ? `Selected commit blocks:\n${manifest.commitScope.selectedBlocks
          .map((block) => `- ${block.baseShortSha}..${block.headShortSha} (${block.commitCount} commits)`)
          .join("\n")}\n\n`
      : "";

  return `# Claude A2E Run\n\nSummary:\n${summaryLines.join("\n")}\n\nRead and execute this manifest exactly:\n- ${manifestPath}\n\n${selectedBlocksSection}Rules:\n${commitScopeRules.join("\n")}\n- Previous runs, old ledgers, old reports, and existing [x] checklist items are context only, not proof.\n- Re-prove the selected scope in the current run.\n- Use run-state, artifacts, cleanup, and final report.\n- If a user-facing feature was not manually observed in this run, mark it not proven.\n\n${operatorNotes.length > 0 ? `Operator notes:\n${operatorNotes.map((line) => `- ${line}`).join("\n")}\n\n` : ""}When the run is complete, leave a terminal run-state and a feature-centric summary.\n`;
}

export async function writeManifestFiles(manifest: Manifest) {
  const manifestPath = path.join("a2e", "state", "manifests", `${manifest.manifestId}.json`);
  const promptPath = path.join("a2e", "state", "manifests", `${manifest.manifestId}.prompt.md`);
  const promptText = buildPrompt(manifest, manifestPath);
  await mkdir(MANIFEST_DIR, { recursive: true });
  await writeFile(path.join(REPO_ROOT, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(REPO_ROOT, promptPath), promptText, "utf8");
  return { manifestPath, promptPath, promptText };
}

export function createManifestId(batchLabel: string) {
  return `${sanitizeLabel(batchLabel) || "a2e-run"}-${formatTimestamp()}`;
}

export type ManifestListEntry = {
  manifestId: string;
  createdAt: string;
  batchLabel: string;
  commitCount: number;
  blockCount: number;
  scenarioCount: number;
  reviewTargets: string[];
  promptStyle: string;
  manifestPath: string;
  promptPath: string;
};

export function listManifests(): ManifestListEntry[] {
  if (!existsSync(MANIFEST_DIR)) return [];
  const files = readdirSync(MANIFEST_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  return files.flatMap((file) => {
    try {
      const raw = readFileSync(path.join(MANIFEST_DIR, file), "utf8");
      const m = JSON.parse(raw) as Manifest;
      const id = m.manifestId;
      return [{
        manifestId: id,
        createdAt: m.createdAt,
        batchLabel: m.batchLabel,
        commitCount: m.commitScope.selectedCommits.length,
        blockCount: m.commitScope.selectedBlocks.length,
        scenarioCount: m.scenarios.selected.length,
        reviewTargets: m.reviewTargets.selected,
        promptStyle: m.settings.promptStyle,
        manifestPath: `a2e/state/manifests/${id}.json`,
        promptPath: `a2e/state/manifests/${id}.prompt.md`,
      }];
    } catch {
      return [];
    }
  });
}

export function readManifestPrompt(manifestId: string): string | null {
  const promptFile = path.join(MANIFEST_DIR, `${manifestId}.prompt.md`);
  if (!existsSync(promptFile)) return null;
  return readFileSync(promptFile, "utf8");
}

export function readManifestJson(manifestId: string): Manifest | null {
  const jsonFile = path.join(MANIFEST_DIR, `${manifestId}.json`);
  if (!existsSync(jsonFile)) return null;
  try {
    return JSON.parse(readFileSync(jsonFile, "utf8")) as Manifest;
  } catch {
    return null;
  }
}
