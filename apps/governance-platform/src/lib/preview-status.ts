import { fetchWorkerJson, getProjectWorkerInfo } from "@/lib/control-plane";

export type ProjectPreviewGenerationResult =
  | { ok: true; generation: string }
  | { ok: false; error: string };

export async function readProjectPreviewGeneration(projectId: string): Promise<ProjectPreviewGenerationResult> {
  const worker = await getProjectWorkerInfo(projectId);
  if (!worker) return { ok: false, error: "Project runtime is unavailable" };
  if (!worker.workerUrl || !worker.containerName) {
    return { ok: false, error: "Project preview runtime is not running" };
  }
  const url = worker.workerUrl + "/containers/" + encodeURIComponent(worker.containerName) + "/preview-generation";
  const response = await fetchWorkerJson(url, { timeoutMs: 5_000 });
  if (!response.ok) return { ok: false, error: "Preview generation could not be read" };
  const generation = response.body && typeof response.body === "object" && !Array.isArray(response.body)
    ? (response.body as Record<string, unknown>).generation
    : null;
  if (typeof generation !== "string" || !generation.trim()) {
    return { ok: false, error: "Preview generation response is invalid" };
  }
  return { ok: true, generation: generation.trim() };
}
