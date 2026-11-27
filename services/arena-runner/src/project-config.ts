import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { RunnerRalphConfigSchema } from "@arena/contracts";

type InitProjectConfigInput = {
  proposal?: {
    title?: string | null;
    description?: string | null;
  } | null;
  project?: {
    id?: string | null;
    name?: string | null;
  } | null;
  repo?: {
    url?: string | null;
    baseBranch?: string | null;
    projectBranch?: string | null;
  } | null;
};

type PackageJson = {
  name?: unknown;
  type?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
};

export type ProjectConfigMaterializationResult =
  | { status: "written"; path: string; techStack: { language: string; framework?: string; runtime?: string } }
  | { status: "preserved"; path: string }
  | { status: "skipped"; path: string; reason: "no_package_json" | "package_json_unreadable" };

export type RalphRuntimeConfigMaterializationResult =
  | { status: "written"; path: string }
  | { status: "skipped"; path: string; reason: "not_configured" };

const GENERATED_BY = "arena-runner";
const PROJECT_CONFIG_FILENAME = "project.config.json";
const RALPH_RUNTIME_CONFIG_RELATIVE_PATH = ".arena/ralph.config.json";

export function materializeRalphProjectConfig(
  workspaceDir: string,
  init: InitProjectConfigInput,
): ProjectConfigMaterializationResult {
  const configPath = join(workspaceDir, PROJECT_CONFIG_FILENAME);
  if (existsSync(configPath)) {
    const existing = readJsonObject(configPath);
    if (!existing || existing.xArenaGeneratedBy !== GENERATED_BY) {
      return { status: "preserved", path: configPath };
    }
  }

  const packageJsonPath = join(workspaceDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return { status: "skipped", path: configPath, reason: "no_package_json" };
  }

  const pkg = readJsonObject(packageJsonPath) as PackageJson | null;
  if (!pkg) {
    return { status: "skipped", path: configPath, reason: "package_json_unreadable" };
  }

  const techStack = inferTechStackFromPackageJson(workspaceDir, pkg);
  const config = {
    xArenaGeneratedBy: GENERATED_BY,
    name: cleanString(init.project?.name) ?? cleanString(init.proposal?.title) ?? cleanString(pkg.name) ?? basename(workspaceDir),
    description: cleanString(init.proposal?.description) ?? "Arena managed project",
    techStack,
    repository: {
      url: sanitizeRepositoryUrl(cleanString(init.repo?.url) ?? ""),
      branch: cleanString(init.repo?.baseBranch) ?? "main",
      deployBranch: cleanString(init.repo?.projectBranch) ?? cleanString(init.repo?.baseBranch) ?? "main",
    },
  };

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  excludeGeneratedProjectConfigFromGit(workspaceDir);
  return { status: "written", path: configPath, techStack };
}

export function materializeRalphRuntimeConfig(
  workspaceDir: string,
  init: unknown,
): RalphRuntimeConfigMaterializationResult {
  const configPath = join(workspaceDir, RALPH_RUNTIME_CONFIG_RELATIVE_PATH);
  const ralphConfig = init && typeof init === "object" && !Array.isArray(init)
    ? (init as { ralphConfig?: unknown | null }).ralphConfig
    : null;
  if (ralphConfig == null) {
    return { status: "skipped", path: configPath, reason: "not_configured" };
  }
  if (!ralphConfig || typeof ralphConfig !== "object" || Array.isArray(ralphConfig)) {
    throw new Error("Invalid init.ralphConfig: expected object.");
  }

  const parsedConfig = RunnerRalphConfigSchema.parse(ralphConfig);
  mkdirSync(join(workspaceDir, ".arena"), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(parsedConfig, null, 2)}\n`, "utf-8");
  excludeGeneratedPathFromGit(workspaceDir, `/${RALPH_RUNTIME_CONFIG_RELATIVE_PATH}`);
  return { status: "written", path: configPath };
}

export function appendRalphConfigFlagToCommand(command: string, configPath: string): string {
  if (/(^|\s)--config(=|\s|$)/.test(command)) {
    throw new Error("Runner init provided ralphConfig, but the agent command already contains --config.");
  }
  return `${command} --config ${shellQuote(configPath)}`;
}

function inferTechStackFromPackageJson(
  workspaceDir: string,
  pkg: PackageJson,
): { language: string; framework?: string; runtime?: string } {
  const dependencies = dependencyNames(pkg);
  const scripts = scriptValues(pkg);

  const frameworks = unique([
    ...frameworkTokens(dependencies),
    ...scriptFrameworkTokens(scripts),
  ]);
  const runtimes = unique([
    ...runtimeTokens(dependencies, scripts),
  ]);

  return {
    language: inferLanguage(workspaceDir, dependencies, scripts),
    ...(frameworks.length > 0 ? { framework: frameworks.join(" ") } : {}),
    ...(runtimes.length > 0 ? { runtime: runtimes.join(" ") } : {}),
  };
}

function dependencyNames(pkg: PackageJson): Set<string> {
  const names = new Set<string>();
  for (const section of [pkg.dependencies, pkg.devDependencies]) {
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    for (const name of Object.keys(section)) names.add(name.toLowerCase());
  }
  return names;
}

function scriptValues(pkg: PackageJson): string[] {
  if (!pkg.scripts || typeof pkg.scripts !== "object" || Array.isArray(pkg.scripts)) return [];
  return Object.values(pkg.scripts)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
}

function inferLanguage(workspaceDir: string, dependencies: Set<string>, scripts: string[]): string {
  if (
    dependencies.has("typescript")
    || existsSync(join(workspaceDir, "tsconfig.json"))
    || scripts.some((script) => /\b(tsx|ts-node|tsc)\b/.test(script))
  ) {
    return "typescript";
  }
  return "javascript";
}

function frameworkTokens(dependencies: Set<string>): string[] {
  const tokens: string[] = [];
  const candidates: Array<[string, string]> = [
    ["@angular/core", "angular"],
    ["@astrojs/node", "astro"],
    ["@babylonjs/core", "babylon"],
    ["@react-three/fiber", "react three"],
    ["@remix-run/node", "remix"],
    ["@sveltejs/kit", "svelte"],
    ["astro", "astro"],
    ["babylonjs", "babylon"],
    ["express", "express"],
    ["fastify", "fastify"],
    ["hono", "hono"],
    ["htmx.org", "htmx"],
    ["koa", "koa"],
    ["next", "next"],
    ["phaser", "phaser"],
    ["pixi.js", "pixi"],
    ["playcanvas", "playcanvas"],
    ["react", "react"],
    ["solid-js", "solid"],
    ["svelte", "svelte"],
    ["three", "three"],
    ["vite", "vite"],
    ["vue", "vue"],
  ];
  for (const [dependency, token] of candidates) {
    if (dependencies.has(dependency)) tokens.push(...token.split(" "));
  }
  return tokens;
}

function scriptFrameworkTokens(scripts: string[]): string[] {
  const tokens: string[] = [];
  for (const script of scripts) {
    if (/\bnext\b/.test(script)) tokens.push("next");
    if (/\bvite\b/.test(script)) tokens.push("vite");
    if (/\bastro\b/.test(script)) tokens.push("astro");
    if (/\bsvelte-kit\b/.test(script)) tokens.push("svelte");
  }
  return tokens;
}

function runtimeTokens(dependencies: Set<string>, scripts: string[]): string[] {
  const tokens: string[] = [];
  if (
    dependencies.has("express")
    || dependencies.has("fastify")
    || dependencies.has("hono")
    || dependencies.has("koa")
    || scripts.some((script) => /\bnode\b/.test(script))
  ) {
    tokens.push("node");
  }
  if (
    dependencies.has("react")
    || dependencies.has("vue")
    || dependencies.has("svelte")
    || dependencies.has("vite")
    || dependencies.has("next")
    || scripts.some((script) => /\b(vite|next|astro|svelte-kit)\b/.test(script))
  ) {
    tokens.push("browser");
  }
  if (dependencies.has("three") || dependencies.has("@react-three/fiber")) tokens.push("webgl");
  if (dependencies.has("pixi.js") || dependencies.has("phaser") || dependencies.has("playcanvas")) tokens.push("canvas");
  return tokens;
}

function excludeGeneratedProjectConfigFromGit(workspaceDir: string): void {
  excludeGeneratedPathFromGit(workspaceDir, `/${PROJECT_CONFIG_FILENAME}`);
}

function excludeGeneratedPathFromGit(workspaceDir: string, generatedPath: string): void {
  const gitDir = join(workspaceDir, ".git");
  if (!existsSync(gitDir)) return;

  try {
    if (!statSync(gitDir).isDirectory()) return;
    const infoDir = join(gitDir, "info");
    const excludePath = join(infoDir, "exclude");
    mkdirSync(infoDir, { recursive: true });
    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf-8") : "";
    if (existing.split(/\r?\n/).some((line) => line.trim() === generatedPath)) return;
    const prefix = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
    appendFileSync(
      excludePath,
      `${prefix}# Arena runner generated Ralph loop input\n${generatedPath}\n`,
      "utf-8",
    );
  } catch {
    // Git exclude is best-effort only; the config file remains non-secret.
  }
}

function sanitizeRepositoryUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return raw.replace(/^(https?:\/\/)[^/@]+@/i, "$1");
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
