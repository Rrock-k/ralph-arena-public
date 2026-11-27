type PreviewGenerationResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type PreviewGenerationFetch = (
  url: string,
  init: { method: "GET"; signal: AbortSignal },
) => Promise<PreviewGenerationResponse>;

export type PreviewGenerationReadResult =
  | { ok: true; generation: string }
  | { ok: false; error: string };

export async function readPreviewGeneration(
  containerName: string,
  deps: { fetchImpl?: PreviewGenerationFetch; requestTimeoutMs?: number } = {},
): Promise<PreviewGenerationReadResult> {
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as PreviewGenerationFetch);
  const url = "http://" + containerName + ":3999/__arena/preview-generation";
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(deps.requestTimeoutMs ?? 2_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const compact = body.replace(/\s+/g, " ").trim().slice(0, 240);
      return {
        ok: false,
        error: "Preview generation endpoint returned HTTP " + response.status + (compact ? ": " + compact : ""),
      };
    }
    const body = await response.json().catch(() => null);
    const generation = body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).generation
      : null;
    if (typeof generation !== "string" || !generation.trim()) {
      return { ok: false, error: "Preview generation endpoint returned an invalid generation" };
    }
    return { ok: true, generation: generation.trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
