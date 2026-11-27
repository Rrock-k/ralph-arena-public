#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const issues = [];

const rel = (absolutePath) => path.relative(repoRoot, absolutePath).split(path.sep).join("/");
const readText = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

function addIssue(message) {
  issues.push(message);
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function listFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [absolutePath];
  if (!stat.isDirectory()) return [];

  const out = [];
  const stack = [absolutePath];
  while (stack.length > 0) {
    const current = stack.pop();
    const currentRel = rel(current);
    if (
      currentRel === ".git" ||
      currentRel === ".claude/worktrees" ||
      currentRel.startsWith(".claude/worktrees/") ||
      currentRel === "docs/backlog" ||
      currentRel.startsWith("docs/backlog/") ||
      currentRel === "work" ||
      currentRel.startsWith("work/") ||
      ["node_modules", ".next", "dist", "build", "coverage"].includes(path.basename(current))
    ) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        out.push(child);
      }
    }
  }
  return out;
}

function checkRetiredInstructionTerms() {
  const allowed = new Set([
    "docs/glossary.md",
    "docs/ops/weekly-instruction-system-maintenance.md",
  ]);
  const patterns = [
    { label: "removed lifecycle field desiredRuntime", regex: /\bdesiredRuntime\b/ },
    { label: "removed lifecycle field actualRuntime", regex: /\bactualRuntime\b/ },
    { label: "removed lifecycle field implState", regex: /\bimplState\b/ },
    { label: "retired loop marker .arena/done", regex: /\.arena\/done\b/ },
  ];

  for (const file of ["AGENTS.md", "CLAUDE.md", ".codex", ".claude", "docs"].flatMap(listFiles)) {
    const relativePath = rel(file);
    if (allowed.has(relativePath)) continue;
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        if (pattern.regex.test(line)) {
          addIssue(`${relativePath}:${index + 1}: ${pattern.label}`);
        }
      }
    });
  }
}

function checkDocsWorkPlacement() {
  for (const root of ["docs/plans", "docs/audit", "docs/history"]) {
    for (const file of listFiles(root)) {
      addIssue(`${rel(file)}: plan/audit/history artifacts belong under work/, not current docs/`);
    }
  }
}

function checkRootInstructionParity() {
  if (!exists("AGENTS.md") || !exists("CLAUDE.md")) return;
  if (readText("AGENTS.md") !== readText("CLAUDE.md")) {
    addIssue("AGENTS.md and CLAUDE.md differ; root instruction drift must be intentional and documented");
  }
}

// RA-249 Claude/Codex parity: the canonical operating rules must stay mirrored across
// the root instructions (AGENTS.md / CLAUDE.md, read by both agents) and the Codex
// operating slice (docs/codex-native-repo-operating-slice.md). Without this, a rule can
// be updated on one side and silently drift on the other, so Claude and Codex stop
// seeing the same operating truth. Each anchor below must appear in BOTH files; when a
// canonical operating rule is added/changed/retired, update both mirrors and keep this
// list in sync.
function checkCodexOperatingSliceParity() {
  const slicePath = "docs/codex-native-repo-operating-slice.md";
  if (!exists("AGENTS.md")) return;
  if (!exists(slicePath)) {
    addIssue(`${slicePath}: missing Codex operating slice (RA-249 Claude/Codex parity)`);
    return;
  }

  const agents = readText("AGENTS.md");
  const slice = readText(slicePath);

  if (!agents.includes(slicePath)) {
    addIssue(`AGENTS.md: must reference ${slicePath} so it stays the declared Codex operating mirror`);
  }

  const sharedRuleAnchors = [
    { label: "prod boundary (no implicit live effect)", anchor: "arena.example.test" },
    { label: "Docker/local stack entrypoint", anchor: "./scripts/docker-local-stack.sh" },
    { label: "DB access only via Docker psql", anchor: "psql -U ralph -d ralph_arena" },
    { label: "governance/admin shell access", anchor: "docker exec agents-arena-governance-platform-1" },
    { label: "post-change smoke path", anchor: "launch -> claim -> status -> terminal state" },
    { label: "auth truth = authd", anchor: "authd" },
    { label: "Codex subscription not on VPS", anchor: "VPS" },
  ];

  for (const { label, anchor } of sharedRuleAnchors) {
    const inAgents = agents.includes(anchor);
    const inSlice = slice.includes(anchor);
    if (inAgents && !inSlice) {
      addIssue(`${slicePath}: canonical operating rule drifted out of the Codex slice — ${label} (anchor "${anchor}" is in AGENTS.md but missing here)`);
    } else if (!inAgents && inSlice) {
      addIssue(`AGENTS.md: canonical operating rule drifted out of root instructions — ${label} (anchor "${anchor}" is in the Codex slice but missing here)`);
    } else if (!inAgents && !inSlice) {
      addIssue(`AGENTS.md + ${slicePath}: canonical operating rule missing from both mirrors — ${label} (anchor "${anchor}")`);
    }
  }
}

// RA-249 Claude/Codex parity for the DETAILED rules: every Claude `.claude/rules/*.md`
// is shared operating guidance, but Codex has no path-based auto-loader, so it only
// follows a rule it is pointed at. Require each rule file to be referenced by path in
// the Codex slice (the content stays single-sourced in the rule file; the slice only
// points). Adapters that just redirect to an already-canonical doc are exempt.
function checkClaudeRulesCodexParity() {
  const rulesDir = ".claude/rules";
  if (!exists(rulesDir)) return;
  const slicePath = "docs/codex-native-repo-operating-slice.md";
  if (!exists(slicePath)) return; // missing-slice already reported by the operating-slice check
  const slice = readText(slicePath);

  // Adapters that only redirect Claude to an already-canonical, AGENTS-referenced doc
  // (no Claude-only operating content) do not need a separate Codex pointer.
  const adapterExemptions = new Set(["glossary.md"]);

  for (const entry of fs.readdirSync(path.join(repoRoot, rulesDir), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (adapterExemptions.has(entry.name)) continue;
    const ruleRef = `${rulesDir}/${entry.name}`;
    if (!slice.includes(ruleRef)) {
      addIssue(`${slicePath}: missing Codex pointer to Claude rule ${ruleRef} — add it under "Detailed rules" so Codex follows the same rule (or exempt it if it is a pure redirect adapter)`);
    }
  }
}

function commandsForHookFile(relativePath, hookName) {
  const json = JSON.parse(readText(relativePath));
  const sections = json.hooks?.[hookName] ?? [];
  const commands = [];
  for (const section of sections) {
    for (const hook of section.hooks ?? []) {
      if (typeof hook.command === "string") commands.push(hook.command);
    }
  }
  return commands;
}

function checkHookParity() {
  const mandatoryStopScripts = [
    "scripts/hook-env-contract.sh",
    "scripts/hook-backlog-format.sh",
    "scripts/hook-accepted-spec-artifact-contract.sh",
    "scripts/hook-instruction-system-maintenance.sh",
  ];

  for (const hookFile of [".codex/hooks.json", ".claude/settings.json"]) {
    const stopCommands = commandsForHookFile(hookFile, "Stop");
    for (const script of mandatoryStopScripts) {
      if (!stopCommands.some((command) => command.includes(script))) {
        addIssue(`${hookFile}: missing mandatory Stop hook ${script}`);
      }
    }
  }
}

function checkLocalSettingsTracked() {
  const tracked = execFileSync("git", ["ls-files", ".claude/settings.local.json"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (tracked) {
    addIssue(".claude/settings.local.json is tracked; project policy belongs in .claude/settings.json");
  }
}

function checkCodexFeatureName() {
  if (!exists(".codex/config.toml")) return;
  const text = readText(".codex/config.toml");
  if (/\bcodex_hooks\s*=/.test(text)) {
    addIssue(".codex/config.toml uses codex_hooks; use hooks = true");
  }
  if (!/\bhooks\s*=\s*true\b/.test(text)) {
    addIssue(".codex/config.toml should enable hooks with hooks = true");
  }
}

function checkRootInstructionDuplicates() {
  for (const relativePath of ["AGENTS.md", "CLAUDE.md"]) {
    if (!exists(relativePath)) continue;
    const lines = readText(relativePath).split(/\r?\n/);
    for (let index = 1; index < lines.length; index += 1) {
      const previous = lines[index - 1].trim();
      const current = lines[index].trim();
      if (current && current === previous) {
        addIssue(`${relativePath}:${index + 1}: duplicate adjacent root instruction line`);
      }
    }
  }
}

function checkRa263LessonPromotionSurface() {
  const toolDocs = readText("docs/ops/arena-ctl-operator-tools-bootstrap.md");
  if (!/RA-263 lesson promotion rule/.test(toolDocs)) {
    addIssue("docs/ops/arena-ctl-operator-tools-bootstrap.md: missing RA-263 lesson promotion rule");
  }
  if (!/one-off forensic detail/.test(toolDocs) || !/missing operator-tool capability/.test(toolDocs)) {
    addIssue("docs/ops/arena-ctl-operator-tools-bootstrap.md: RA-263 rule must distinguish one-off forensic detail from missing operator-tool capability");
  }

  const weeklyDocs = readText("docs/ops/weekly-instruction-system-maintenance.md");
  if (!/RA-263 lesson promotion check/.test(weeklyDocs)) {
    addIssue("docs/ops/weekly-instruction-system-maintenance.md: missing RA-263 lesson promotion check");
  }
}

function checkWeeklyAutomationDigestContract() {
  const weeklyDocs = readText("docs/ops/weekly-instruction-system-maintenance.md");
  if (!/Operator digest/.test(weeklyDocs)) {
    addIssue("docs/ops/weekly-instruction-system-maintenance.md: missing Operator digest output contract");
  }
  if (!/same automation run|той же automation/.test(weeklyDocs)) {
    addIssue("docs/ops/weekly-instruction-system-maintenance.md: digest must be generated by the same automation run");
  }
  if (!weeklyDocs.includes("delivery layer") || !weeklyDocs.includes("отправлять текст")) {
    addIssue("docs/ops/weekly-instruction-system-maintenance.md: digest delivery must use the automation-authored section");
  }
}

checkRetiredInstructionTerms();
checkDocsWorkPlacement();
checkRootInstructionParity();
checkCodexOperatingSliceParity();
checkClaudeRulesCodexParity();
checkHookParity();
checkLocalSettingsTracked();
checkCodexFeatureName();
checkRootInstructionDuplicates();
checkRa263LessonPromotionSurface();
checkWeeklyAutomationDigestContract();

if (issues.length > 0) {
  console.error("Instruction system maintenance check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Instruction system maintenance check passed.");
