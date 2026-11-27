import type { ArenaCtlConfig } from "./config.js";

export class GovernanceClient {
  constructor(private readonly config: ArenaCtlConfig) {}

  getSystemOverview() {
    return this.getJson("/system-overview");
  }

  getAuthdHealth() {
    return this.getJson("/authd/health");
  }

  getProjectHealth(projectId: string, tail?: number) {
    const query = tail ? `?tail=${encodeURIComponent(String(tail))}` : "";
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/health${query}`);
  }

  getProjectSpecs(projectId: string) {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/specs`);
  }

  getProjectWorkerInfo(projectId: string): Promise<{ projectId: string; containerName: string | null; workerUrl: string | null }> {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/worker-info`);
  }

  getProjectWorkerSnapshot(projectId: string, tail?: number) {
    const query = tail ? `?tail=${encodeURIComponent(String(tail))}` : "";
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/worker-snapshot${query}`);
  }

  getProjectSnapshot(projectId: string) {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/snapshot`);
  }

  getProjectRuntimeClaimDryRun(projectId: string, opts?: {
    host?: string;
    capacity?: number;
    activePreviewContainers?: string[];
  }) {
    const params = new URLSearchParams();
    if (opts?.host) params.set("host", opts.host);
    if (typeof opts?.capacity === "number") params.set("capacity", String(opts.capacity));
    if (opts?.activePreviewContainers?.length) {
      params.set("activePreviewContainers", opts.activePreviewContainers.join(","));
    }
    const query = params.toString();
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/runtime-claim-dry-run${query ? `?${query}` : ""}`);
  }

  getProjectRunnerInitReadiness(projectId: string) {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/runner-init-readiness`);
  }

  getProjectUpdates(projectId: string, tail?: number) {
    const query = tail ? `?tail=${encodeURIComponent(String(tail))}` : "";
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/updates${query}`);
  }

  getProjectProofReviews(projectId: string) {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/proof-reviews`);
  }

  getProjectVisualEvidenceArtifactCheck(projectId: string) {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/visual-evidence-artifact-check`);
  }

  getProjectSpecArtifactAudit(projectId: string) {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/spec-artifact-audit`);
  }

  attemptProjectRecovery(projectId: string, body: {
    action: string;
  }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/recovery/attempt`, body);
  }

  getAudit(opts?: { projectIds?: string[]; includeArchived?: boolean; skipFilesystem?: boolean; includeMigrationChecks?: boolean }) {
    const params = new URLSearchParams();
    if (opts?.projectIds?.length) params.set("projectIds", opts.projectIds.join(","));
    if (opts?.includeArchived) params.set("includeArchived", "true");
    if (opts?.skipFilesystem) params.set("skipFilesystem", "true");
    if (opts?.includeMigrationChecks) params.set("includeMigrationChecks", "true");
    const query = params.toString();
    // Audit with migration checks can be slow (filesystem + GitHub API) — use longer timeout
    const timeoutMs = opts?.includeMigrationChecks ? 120_000 : 20_000;
    return this.getJson(`/audit${query ? `?${query}` : ""}`, timeoutMs);
  }

  getFleetTupleAudit(opts?: { includeArchived?: boolean; limitExamples?: number }) {
    const params = new URLSearchParams();
    if (opts?.includeArchived) params.set("includeArchived", "true");
    if (typeof opts?.limitExamples === "number") params.set("limitExamples", String(opts.limitExamples));
    const query = params.toString();
    return this.getJson(`/fleet/tuple-audit${query ? `?${query}` : ""}`);
  }

  getFleetSpecArtifactAudit(opts?: { includeArchived?: boolean; limitProjects?: number }) {
    const params = new URLSearchParams();
    if (opts?.includeArchived === false) params.set("includeArchived", "false");
    if (typeof opts?.limitProjects === "number") params.set("limitProjects", String(opts.limitProjects));
    const query = params.toString();
    return this.getJson(`/fleet/spec-artifact-audit${query ? `?${query}` : ""}`);
  }

  refreshTokens(force?: boolean) {
    return this.postJson("/tokens/refresh", force ? { force } : {});
  }

  getTokenStatus() {
    return this.getJson("/tokens/status");
  }

  relaunchProject(projectId: string, body: Record<string, unknown>) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/relaunch`, body);
  }

  retryProjectNow(projectId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/retry-now`, {});
  }

  startTgSpecLaunch(projectId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/tg-spec-launch-start`, {});
  }

  configureTgSpecLaunch(projectId: string, body: Record<string, unknown>) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/tg-spec-launch-configure`, body);
  }

  archiveProject(projectId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/archive`, {});
  }

  unarchiveProject(projectId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/unarchive`, {});
  }

  setAgentIntent(projectId: string, intent: "ON" | "OFF") {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/${intent === "ON" ? "agent-on" : "agent-off"}`, {});
  }

  setPowerIntent(projectId: string, intent: "ON" | "OFF") {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/${intent === "ON" ? "power-on" : "power-off"}`, {});
  }

  refreshProjectPreview(projectId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/preview-refresh`, {});
  }

  restartWorkerService(workerHost: string, body: { vpsIp?: string | null } = {}) {
    return this.postJson(`/workers/${encodeURIComponent(workerHost)}/restart-service`, body);
  }

  recreateProjectRuntime(projectId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/recovery/attempt`, {
      action: "recreate_runtime",
    });
  }

  deleteProject(projectId: string, body: { removeDocker?: boolean; removeWorkspace?: boolean } = {}) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/delete`, body);
  }

  addSpec(projectId: string, body: { title?: string; content: string }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/specs`, body);
  }

  setBudget(projectId: string, body: { totalCreditsUsd: number; isEnabled?: boolean; note?: string }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/budget`, body);
  }

  provideSecret(projectId: string, body: { key: string; value: string; description?: string }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/secrets`, body);
  }

  addRequiredSecret(projectId: string, body: { key: string; description?: string }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/required-secrets/add`, body);
  }

  removeRequiredSecret(projectId: string, body: { key: string }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/required-secrets/remove`, body);
  }

  normalizeSourceConfigRecipe(projectId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/source-config/normalize-recipe`, {});
  }

  setProjectVisibility(projectId: string, visibility: "private" | "public" | "featured") {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/visibility`, { visibility });
  }

  setProjectModel(projectId: string, model: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/model`, { model });
  }

  setProjectRuntimeSystem(projectId: string, body: {
    agent: string;
    agentImpl: string;
    model?: string | null;
    toolId?: string | null;
    providerBillingMode: string | null;
    claudeAuthMode?: string | null;
    codexAuthMode?: string | null;
  }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/runtime-system`, body);
  }

  setProjectSourceSnapshot(projectId: string, commitSha: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/source-snapshot`, { commitSha });
  }

  setProjectRuntimeAuthModes(projectId: string, body: {
    claudeAuthMode?: string | null;
    codexAuthMode?: string | null;
  }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/runtime-auth-modes`, body);
  }

  setProjectVisualEvidenceMode(projectId: string, visualEvidenceMode: "off" | "required" | "new_tasks_only") {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/visual-evidence-mode`, { visualEvidenceMode });
  }

  ingestProjectVisualEvidence(projectId: string, body: {
    taskId: string;
    sourceEvidenceRef: string;
    progressJson: string;
    artifactFilename: string;
    artifactContentType: string;
    artifactContentBase64: string;
  }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/visual-evidence-ingest`, body);
  }

  listAssets(projectId: string) {
    return this.getJson(`/projects/${encodeURIComponent(projectId)}/assets`);
  }

  uploadAsset(projectId: string, body: { filename: string; contentBase64: string; contentType?: string; path?: string }) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/assets`, body);
  }

  deleteAsset(projectId: string, assetId: string) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/delete`, {});
  }

  createPersonalProject(body: Record<string, unknown>) {
    return this.postJson("/projects/create", body);
  }

  createTgSpecTargetProject(body: Record<string, unknown>) {
    return this.postJson("/projects/tg-spec-target-create", body);
  }

  importTgSpecAcceptedArtifact(projectId: string, body: Record<string, unknown>) {
    return this.postJson(`/projects/${encodeURIComponent(projectId)}/tg-spec-accepted-artifact-import`, body);
  }

  launchProposal(body: Record<string, unknown>) {
    return this.postJson("/projects/launch-proposal", body);
  }

  deleteProposal(proposalId: string) {
    return this.postJson(`/proposals/${encodeURIComponent(proposalId)}/delete`, {});
  }

  purgeProposal(proposalId: string) {
    return this.postJson(`/proposals/${encodeURIComponent(proposalId)}/purge`, {});
  }

  private getJson<T>(path: string, timeoutMs?: number): Promise<T> {
    return this.request<T>("GET", path, undefined, timeoutMs);
  }

  private postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
    const url = `${this.config.governanceUrl}/api/admin/ctl${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          "x-arena-admin-secret": this.config.adminSecret,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(formatGovernanceTransportError({
        method,
        path,
        governanceUrl: this.config.governanceUrl,
        timeoutMs,
        cause: error,
      }));
    }

    const raw = await response.text();
    const data = parseJson(raw);

    if (!response.ok) {
      const error = typeof data === "object" && data && "error" in data
        ? String((data as { error?: unknown }).error || `HTTP ${response.status}`)
        : `${method} ${path} failed (${response.status})`;
      throw new Error(error);
    }

    return data as T;
  }
}

export function formatGovernanceTransportError(input: {
  method: "GET" | "POST";
  path: string;
  governanceUrl: string;
  timeoutMs: number;
  cause: unknown;
}): string {
  const apiPath = `/api/admin/ctl${input.path}`;
  const causeMessage = formatErrorCause(input.cause);
  const prefix = `${input.method} ${apiPath} failed before HTTP response from ${input.governanceUrl}`;
  const operatorHint = "Check that governance is running and that GOVERNANCE_ADMIN_URL/GOVERNANCE_URL points at the local admin service or tunnel.";

  if (isTimeoutLikeError(input.cause)) {
    return `${prefix}: timed out after ${input.timeoutMs}ms. ${operatorHint}`;
  }

  return `${prefix}: ${causeMessage}. ${operatorHint}`;
}

function parseJson(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function formatErrorCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error || "unknown transport error");
  const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
  return `${name}${error.message || "unknown transport error"}`;
}

function isTimeoutLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError"
    || error.name === "AbortError"
    || /aborted|timeout|timed out/i.test(error.message);
}
