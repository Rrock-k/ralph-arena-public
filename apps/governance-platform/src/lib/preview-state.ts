export interface PreviewStateLike {
  powerIntent?: string | null;
  agentIntent?: string | null;
  runtimeState?: string | null;
  agentState?: string | null;
  lastOutcome?: string | null;
  previewUrl?: string | null;
  previewHealth?: string | null;
  containerName?: string | null;
}

export function isRetainedPreviewRow(state: PreviewStateLike | null | undefined): boolean {
  if (!state) return false;
  return state.agentState === "IDLE"
    && (state.lastOutcome === "COMPLETED" || state.agentIntent === "OFF");
}

export function hasLivePreviewFact(
  state: PreviewStateLike | null | undefined,
  fallbackPreviewUrl?: string | null,
): boolean {
  if (!state) return false;
  if (state.powerIntent === "OFF") return false;
  if (state.runtimeState !== "RUNNING") return false;
  if (state.agentState !== "IDLE") return false;

  const previewUrl = state.previewUrl ?? fallbackPreviewUrl ?? null;
  if (previewUrl) return true;
  if (state.previewHealth === "HEALTHY") return Boolean(state.containerName?.trim());

  return isRetainedPreviewRow(state) && Boolean(state.containerName?.trim());
}
