/**
 * RA-083: Progress reader for runner.
 * Reads .arena/progress.json from workspace and pushes to governance.
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { basename, isAbsolute, join, normalize, resolve, sep } from "path";
import { pushProgress, pushVisualEvidenceIngest } from "./api.js";

const PROGRESS_FILE = ".arena/progress.json";
const VISUAL_EVIDENCE_INGEST_MANIFEST_FILE = ".arena/visual-evidence-ingest-manifest.json";
const VISUAL_EVIDENCE_INGEST_MANIFEST_SCHEMA_VERSION = "ra-356.visual-evidence-ingest-manifest.v1";
const VISUAL_EVIDENCE_MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const VISUAL_EVIDENCE_RETRY_DELAY_MS = 60_000;
const PUSH_INTERVAL_MS = 5000;

export interface AgentProgress {
  state: string;
  message?: string;
  iteration?: number;
  steps?: Array<{ id: string; label: string; status: string; displayTitle?: string; description?: string }>;
  custom?: Record<string, unknown>;
}

type PreviewActual = "SERVING" | "ERROR";
type VisualEvidenceManifestItem = {
  taskId: string;
  sourceEvidenceRef: string;
  artifactPath: string;
  artifactSha256: string;
  artifactContentType: string;
};

export class ProgressWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlightPushes = new Set<Promise<unknown>>();
  private lastState: string | null = null;
  private lastMessage: string | null = null;
  private lastIteration: number | null = null;
  private lastProgressRaw: string | null = null;
  private lastProgressFilePresent: boolean | null = null;
  private lastStateChangedAt: number | null = null;
  private lastActivityAt: number | null = null;
  private visualEvidenceIngestSucceeded = new Set<string>();
  private visualEvidenceIngestRetryAfter = new Map<string, number>();
  private workDir: string;
  private onCompleted: (() => void) | null = null;
  private getPreviewActual: (() => PreviewActual | undefined) | null = null;
  private onIterationAdvanced: ((iteration: number) => void | Promise<void>) | null = null;

  constructor(
    workDir: string,
    options?: {
      getPreviewActual?: () => PreviewActual | undefined;
      onIterationAdvanced?: (iteration: number) => void | Promise<void>;
    },
  ) {
    this.workDir = workDir;
    this.getPreviewActual = options?.getPreviewActual ?? null;
    this.onIterationAdvanced = options?.onIterationAdvanced ?? null;
  }

  start(onCompleted: () => void): void {
    this.onCompleted = onCompleted;
    this.timer = setInterval(() => this.check(), PUSH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    if (this.inFlightPushes.size > 0) {
      await Promise.allSettled([...this.inFlightPushes]);
    }
    await this.flushLatest();
  }

  getLastState(): string | null {
    return this.lastState;
  }

  getLastMessage(): string | null {
    return this.lastMessage;
  }

  getLastSnapshot(): { state: string | null; message: string | null } {
    return {
      state: this.lastState,
      message: this.lastMessage,
    };
  }

  getLastStateChangedAt(): number | null {
    return this.lastStateChangedAt;
  }

  getLastActivityAt(): number | null {
    return this.lastActivityAt;
  }

  private check(): void {
    void this.pushLatest();
  }

  private async flushLatest(): Promise<void> {
    await this.pushLatest();
  }

  private async pushLatest(): Promise<void> {
    try {
      const raw = readFileSync(join(this.workDir, PROGRESS_FILE), "utf-8");
      this.lastProgressFilePresent = true;
      this.lastProgressRaw = raw;
      const progress: AgentProgress = JSON.parse(raw);
      const stateChanged = this.lastState !== progress.state;
      const messageChanged = this.lastMessage !== (typeof progress.message === "string" ? progress.message : null);
      const normalizedIteration =
        typeof progress.iteration === "number" && Number.isFinite(progress.iteration)
          ? Math.max(0, Math.floor(progress.iteration))
          : null;
      const iterationChanged = this.lastIteration !== normalizedIteration;
      const iterationAdvanced =
        this.lastIteration !== null && normalizedIteration !== null && normalizedIteration > this.lastIteration;
      if (stateChanged) {
        this.lastStateChangedAt = Date.now();
      }
      this.lastState = progress.state;
      this.lastMessage = typeof progress.message === "string" ? progress.message : null;
      this.lastIteration = normalizedIteration;
      // Only update activity timestamp when something actually changed
      if (stateChanged || messageChanged || iterationChanged) {
        this.lastActivityAt = Date.now();
      }

      const previewActual = this.getPreviewActual?.();
      const telegramMiniAppUrl = typeof progress.custom?.telegramMiniAppUrl === "string"
        ? progress.custom.telegramMiniAppUrl
        : undefined;
      const push = pushProgress({
        eventType: "project_progress",
        progressJson: raw,
        ...(previewActual ? { previewActual } : {}),
        ...(telegramMiniAppUrl ? { telegramMiniAppUrl } : {}),
      });
      this.inFlightPushes.add(push);

      if (iterationAdvanced && normalizedIteration !== null) {
        void Promise.resolve(this.onIterationAdvanced?.(normalizedIteration)).catch((error) => {
          console.error(
            "[runner] iteration-advanced callback failed:",
            error instanceof Error ? error.message : String(error),
          );
        });
      }

      if (progress.state === "completed") {
        this.onCompleted?.();
      }

      const progressPersisted = await push.finally(() => {
        this.inFlightPushes.delete(push);
      });
      if (!progressPersisted) return;
      await this.pushVisualEvidenceIngestManifest(raw);
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
        if (this.lastProgressFilePresent === true && this.lastProgressRaw) {
          this.lastProgressFilePresent = false;
          const previewActual = this.getPreviewActual?.();
          const push = pushProgress({
            eventType: "project_progress",
            progressJson: this.lastProgressRaw,
            ...(previewActual ? { previewActual } : {}),
          });
          this.inFlightPushes.add(push);
          await push.finally(() => {
            this.inFlightPushes.delete(push);
          });
        } else if (this.lastProgressFilePresent !== false) {
          this.lastProgressFilePresent = false;
          this.lastState = null;
          this.lastMessage = null;
          this.lastIteration = null;
          this.lastProgressRaw = null;
          const previewActual = this.getPreviewActual?.();
          const push = pushProgress({
            eventType: "project_progress",
            progressJson: null,
            ...(previewActual ? { previewActual } : {}),
          });
          this.inFlightPushes.add(push);
          await push.finally(() => {
            this.inFlightPushes.delete(push);
          });
        }
        return;
      }
      console.error("[runner] progress check failed:", e);
    }
  }

  private async pushVisualEvidenceIngestManifest(progressJson: string): Promise<void> {
    const manifest = this.readVisualEvidenceIngestManifest();
    if (manifest.length === 0) return;

    for (const item of manifest) {
      const key = visualEvidenceManifestItemKey(item);
      if (this.visualEvidenceIngestSucceeded.has(key)) continue;
      const retryAfter = this.visualEvidenceIngestRetryAfter.get(key) ?? 0;
      if (retryAfter > Date.now()) continue;
      if (!progressContainsVisualEvidence(progressJson, item)) continue;

      let artifact: Buffer;
      try {
        artifact = this.readVisualEvidenceArtifact(item);
      } catch (error) {
        console.warn(`[runner] visual evidence ingest skipped: ${describeError(error)}`);
        this.visualEvidenceIngestRetryAfter.set(key, Date.now() + VISUAL_EVIDENCE_RETRY_DELAY_MS);
        continue;
      }

      const ok = await pushVisualEvidenceIngest({
        taskId: item.taskId,
        sourceEvidenceRef: item.sourceEvidenceRef,
        progressJson,
        artifactFilename: basename(item.artifactPath),
        artifactContentType: item.artifactContentType,
        artifactContentBase64: artifact.toString("base64"),
      });
      if (ok) {
        console.log(
          `[runner] visual evidence ingest accepted: taskId=${item.taskId} sourceEvidenceRef=${item.sourceEvidenceRef} artifactSha256=${item.artifactSha256}`,
        );
        this.visualEvidenceIngestSucceeded.add(key);
        this.visualEvidenceIngestRetryAfter.delete(key);
      } else {
        this.visualEvidenceIngestRetryAfter.set(key, Date.now() + VISUAL_EVIDENCE_RETRY_DELAY_MS);
      }
    }
  }

  private readVisualEvidenceIngestManifest(): VisualEvidenceManifestItem[] {
    let raw: string;
    try {
      raw = readFileSync(join(this.workDir, VISUAL_EVIDENCE_INGEST_MANIFEST_FILE), "utf-8");
    } catch (error) {
      if (isEnoent(error)) return [];
      console.warn(`[runner] visual evidence ingest manifest unreadable: ${describeError(error)}`);
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn("[runner] visual evidence ingest manifest ignored: invalid JSON");
      return [];
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== VISUAL_EVIDENCE_INGEST_MANIFEST_SCHEMA_VERSION) {
      return [];
    }
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items
      .map(parseVisualEvidenceManifestItem)
      .filter((item): item is VisualEvidenceManifestItem => item != null);
  }

  private readVisualEvidenceArtifact(item: VisualEvidenceManifestItem): Buffer {
    if (!item.artifactPath.startsWith(".ralph/visual-workbench/")) {
      throw new Error("artifact_path_outside_visual_workbench");
    }
    const normalizedArtifactPath = normalize(item.artifactPath).replace(/\\/g, "/");
    if (
      isAbsolute(item.artifactPath)
      || item.artifactPath.includes("\0")
      || normalizedArtifactPath !== item.artifactPath
      || item.artifactPath.split("/").includes("..")
    ) {
      throw new Error("artifact_path_invalid");
    }
    const artifactPath = resolve(this.workDir, item.artifactPath);
    const workDir = resolve(this.workDir);
    if (artifactPath !== workDir && !artifactPath.startsWith(`${workDir}${sep}`)) {
      throw new Error("artifact_path_outside_workspace");
    }
    const artifact = readFileSync(artifactPath);
    if (!Buffer.isBuffer(artifact)) {
      throw new Error("artifact_read_not_binary");
    }
    if (artifact.byteLength <= 0) {
      throw new Error("artifact_empty");
    }
    if (artifact.byteLength > VISUAL_EVIDENCE_MAX_ARTIFACT_BYTES) {
      throw new Error("artifact_too_large");
    }
    const digest = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;
    if (digest !== item.artifactSha256) {
      throw new Error("artifact_digest_mismatch");
    }
    return artifact;
  }
}

function parseVisualEvidenceManifestItem(value: unknown): VisualEvidenceManifestItem | null {
  if (!isRecord(value)) return null;
  const taskId = cleanStableText(value.taskId, 160);
  const sourceEvidenceRef = cleanVisualEvidenceRef(value.sourceEvidenceRef);
  const artifactPath = cleanArtifactPath(value.artifactPath);
  const artifactSha256 = cleanArtifactSha(value.artifactSha256);
  const artifactContentType = value.artifactContentType === "image/png" ? "image/png" : null;
  if (!taskId || !sourceEvidenceRef || !artifactPath || !artifactSha256 || !artifactContentType) return null;
  return {
    taskId,
    sourceEvidenceRef,
    artifactPath,
    artifactSha256,
    artifactContentType,
  };
}

function progressContainsVisualEvidence(progressJson: string, item: VisualEvidenceManifestItem): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(progressJson);
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) return false;
  const matchingSteps = parsed.steps.filter((step): step is Record<string, unknown> => (
    isRecord(step) && step.id === item.taskId
  ));
  if (matchingSteps.length !== 1) return false;
  const evidence = matchingSteps[0].visualEvidence;
  if (!Array.isArray(evidence)) return false;
  return evidence.some((row) => (
    isRecord(row)
    && row.sourceEvidenceRef === item.sourceEvidenceRef
    && row.artifactSha256 === item.artifactSha256
  ));
}

function visualEvidenceManifestItemKey(item: VisualEvidenceManifestItem): string {
  return `${item.taskId}\0${item.sourceEvidenceRef}\0${item.artifactSha256}`;
}

function cleanStableText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > maxLength || !/^[A-Za-z0-9_:\-./]+$/.test(text)) return null;
  return text;
}

function cleanVisualEvidenceRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 420 || !/^[A-Za-z0-9._:-]+$/.test(text)) return null;
  if (!text.startsWith("visual-workbench-capture:")) return null;
  return text;
}

function cleanArtifactPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\\/g, "/");
  if (!text || isAbsolute(text) || text.includes("\0")) return null;
  const normalized = normalize(text).replace(/\\/g, "/");
  if (
    normalized !== text
    || text.split("/").includes("..")
    || !normalized.startsWith(".ralph/visual-workbench/")
    || !normalized.endsWith(".png")
  ) {
    return null;
  }
  return normalized;
}

function cleanArtifactSha(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return /^sha256:[a-f0-9]{64}$/.test(text) ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return error != null
    && typeof error === "object"
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
