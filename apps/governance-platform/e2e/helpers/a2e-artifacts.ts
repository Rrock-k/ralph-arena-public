import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import { cp, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { a2ePost, getPreviewResponse, getProjectState, type ProjectState, type WorkerParity } from "./runtime-a2e";

type ScenarioLane = "lane_1" | "lane_2" | "lane_3" | "lane_4";
type ScenarioEnvironment = "local" | "vps" | "manual";

type ScenarioMeta = {
  scenarioId: string;
  lane: ScenarioLane;
  environment: ScenarioEnvironment;
  bootstrapKind: string;
  testTitle: string;
  testInfo: TestInfo;
  request: APIRequestContext;
  page?: Page;
};

type WorkerInspect = {
  status?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  oomKilled?: boolean;
  error?: string | null;
  image?: string | null;
  memoryUsageBytes?: number | null;
  memoryLimitBytes?: number | null;
};

type WorkerMeta = {
  hostId?: string;
  worker?: Record<string, unknown>;
  runner?: Record<string, unknown>;
  containerRuntime?: Record<string, unknown>;
  [key: string]: unknown;
};

type ScenarioVerdict = "PASS" | "FAIL_PRODUCT" | "FAIL_ENV" | "FAIL_PARITY";

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const ARTIFACTS_ROOT = path.join(REPO_ROOT, "a2e", "artifacts");
const RUN_ID = process.env.A2E_RUN_ID || `local-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const CURRENT_COMMIT_SHA = readCurrentCommitSha();
const WORKING_TREE_DIRTY = readWorkingTreeDirty();

function readCurrentCommitSha(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function readWorkingTreeDirty(): boolean {
  try {
    return execSync("git status --porcelain", { cwd: REPO_ROOT, encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

type WorkerSnapshot = {
  workerUrl: string | null;
  meta: WorkerMeta | null;
  inspect: WorkerInspect | null;
  logs: { logs?: string } | null;
  parity?: WorkerParity | null;
  errors?: Record<string, unknown>;
};

type FailureClassification = {
  verdict: ScenarioVerdict;
  reasonCode: string;
  summary: string;
};

async function fetchPreviewCheck(
  request: APIRequestContext,
  previewUrl: string | null,
): Promise<Record<string, unknown>> {
  if (!previewUrl) {
    return { previewUrl: null, rootStatus: null, healthStatus: null };
  }

  const root = await getPreviewResponse(request, previewUrl, {
    failOnStatusCode: false,
    timeout: 15_000,
  }).catch(() => null);

  let healthStatus: number | null = null;
  try {
    const health = await getPreviewResponse(request, new URL("/health", previewUrl).toString(), {
      failOnStatusCode: false,
      timeout: 15_000,
    });
    healthStatus = health.status();
  } catch {
    healthStatus = null;
  }

  return {
    previewUrl,
    rootStatus: root?.status() ?? null,
    rootContentType: root?.headers()["content-type"] ?? null,
    healthStatus,
  };
}

export class ScenarioArtifactBundle {
  private readonly dir: string;
  private projectId: string | null = null;
  private previewUrl: string | null = null;
  private readonly notes: string[] = [];
  private readonly consoleErrors: string[] = [];
  private readonly pageErrors: string[] = [];

  constructor(private readonly meta: ScenarioMeta) {
    const scenarioDir = sanitizePathSegment(meta.scenarioId);
    this.dir = path.join(ARTIFACTS_ROOT, RUN_ID, scenarioDir);

    if (meta.page) {
      meta.page.on("console", (msg) => {
        if (msg.type() === "error") {
          this.consoleErrors.push(msg.text());
        }
      });
      meta.page.on("pageerror", (error) => {
        this.pageErrors.push(String(error));
      });
    }
  }

  setProjectId(projectId: string) {
    this.projectId = projectId;
  }

  setPreviewUrl(previewUrl: string | null | undefined) {
    this.previewUrl = previewUrl ?? null;
  }

  note(message: string) {
    this.notes.push(message);
  }

  async pass() {
    await this.write("PASS");
  }

  async fail(error: unknown) {
    await this.write(null, error);
  }

  private async write(presetVerdict: ScenarioVerdict | null, error?: unknown) {
    const browserDir = path.join(this.dir, "browser");
    await mkdir(browserDir, { recursive: true });

    const projectState = this.projectId
      ? await getProjectState(this.meta.request, this.projectId).catch(() => null)
      : null;
    const previewCheck = await fetchPreviewCheck(
      this.meta.request,
      this.previewUrl ?? projectState?.previewUrl ?? null,
    );

    const workerSnapshot = projectState?.id
      ? await a2ePost<WorkerSnapshot>(this.meta.request, {
        action: "worker_snapshot",
        projectId: projectState.id,
      }).catch(() => null)
      : null;

    const workerInspect = workerSnapshot?.inspect ?? null;
    const workerLogs = workerSnapshot?.logs?.logs ?? null;
    const workerMeta = workerSnapshot?.meta ?? null;
    const workerParity = workerSnapshot?.parity ?? null;
    const classification = error
      ? classifyFailure({
        environment: this.meta.environment,
        projectState,
        workerSnapshot,
        workerInspect,
        error,
      })
      : null;
    const verdict = presetVerdict ?? classification?.verdict ?? "FAIL_PRODUCT";

    const errorPayload = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack ?? null }
      : error
        ? { message: String(error) }
        : null;

    const scenarioJson = {
      id: this.meta.scenarioId,
      lane: this.meta.lane,
      environment: this.meta.environment,
      bootstrapKind: this.meta.bootstrapKind,
      testTitle: this.meta.testTitle,
      verdict,
      commitSha: CURRENT_COMMIT_SHA,
      workingTreeDirty: WORKING_TREE_DIRTY,
      runId: RUN_ID,
      capturedAt: new Date().toISOString(),
      projectId: projectState?.id ?? this.projectId,
      previewUrl: (previewCheck.previewUrl as string | null) ?? null,
      playwrightOutputDir: this.meta.testInfo.outputDir,
      notes: this.notes,
      classification,
      error: errorPayload,
    };

    await writeFile(
      path.join(this.dir, "scenario.json"),
      JSON.stringify(scenarioJson, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "project-state.json"),
      JSON.stringify(projectState, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "runlogs.json"),
      JSON.stringify(projectState?.runLogs ?? [], null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "preview-check.json"),
      JSON.stringify(previewCheck, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "worker-inspect.json"),
      JSON.stringify(workerInspect, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "worker-meta.json"),
      JSON.stringify(workerMeta, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "worker-parity.json"),
      JSON.stringify(workerParity, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "worker-snapshot-errors.json"),
      JSON.stringify(workerSnapshot?.errors ?? null, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(this.dir, "worker-logs.txt"),
      workerLogs ?? "",
      "utf8",
    );

    const browserConsole = [...this.consoleErrors, ...this.pageErrors];
    await writeFile(
      path.join(this.dir, "browser", "console.txt"),
      browserConsole.join("\n"),
      "utf8",
    );

    await copyPlaywrightOutput(this.meta.testInfo.outputDir, browserDir);

    if (error && this.meta.page) {
      await this.meta.page.screenshot({
        path: path.join(this.dir, "browser", "screenshot.png"),
        fullPage: true,
      }).catch(() => undefined);
    }
  }
}

export async function withScenarioArtifacts<T>(
  meta: ScenarioMeta,
  run: (bundle: ScenarioArtifactBundle) => Promise<T>,
): Promise<T> {
  const bundle = new ScenarioArtifactBundle(meta);
  try {
    const result = await run(bundle);
    await bundle.pass();
    return result;
  } catch (error) {
    await bundle.fail(error);
    throw error;
  }
}

async function copyPlaywrightOutput(outputDir: string, browserDir: string): Promise<void> {
  try {
    await cp(outputDir, path.join(browserDir, "playwright-output"), {
      recursive: true,
      force: true,
    });
  } catch {
    // Output dir may be empty for passing tests.
  }
}

function classifyFailure(input: {
  environment: ScenarioEnvironment;
  projectState: ProjectState | null;
  workerSnapshot: WorkerSnapshot | null;
  workerInspect: WorkerInspect | null;
  error?: unknown;
}): FailureClassification {
  const { environment, projectState, workerSnapshot, workerInspect, error } = input;
  const metaError = workerSnapshot?.errors?.meta;
  const errorMessage = error instanceof Error ? error.message : String(error ?? "");

  if (
    errorMessage.includes("ECONNREFUSED") ||
    errorMessage.includes("ECONNRESET") ||
    errorMessage.includes("socket hang up")
  ) {
    return {
      verdict: "FAIL_ENV",
      reasonCode: "playwright_dev_server_unavailable",
      summary: "Playwright hit a transient governance dev-server connectivity error before the scenario stabilized.",
    };
  }

  if (metaError) {
    return {
      verdict: "FAIL_PARITY",
      reasonCode: "worker_meta_unavailable",
      summary: `Worker parity metadata was not readable in ${environment} environment.`,
    };
  }

  if (environment === "vps" && workerSnapshot?.parity?.status !== "clean") {
    return {
      verdict: "FAIL_PARITY",
      reasonCode: "worker_parity_mismatch",
      summary: `Remote worker parity is ${workerSnapshot?.parity?.status || "unknown"}: ${(workerSnapshot?.parity?.reasons || []).join(", ") || "no reason provided"}`,
    };
  }

  if (workerInspect?.oomKilled) {
    return {
      verdict: "FAIL_ENV",
      reasonCode: "container_oom_killed",
      summary: "Container was OOM-killed before becoming preview-ready.",
    };
  }

  if (workerInspect?.status === "not_found" && projectState?.displayStatus !== "CANCELED") {
    return {
      verdict: "FAIL_ENV",
      reasonCode: "container_missing",
      summary: "Expected runtime container was missing during artifact capture.",
    };
  }

  return {
    verdict: "FAIL_PRODUCT",
    reasonCode: "scenario_assertion_failed",
    summary: "Scenario assertion failed with current product/runtime implementation.",
  };
}
