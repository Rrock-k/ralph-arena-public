export function shouldYieldPreviewOnlyMissingBootstrapToAgent(input: {
  agentIntent: "ON" | "OFF" | string | undefined;
  hasPendingLoopWork: boolean | undefined;
  previewStarted: boolean;
  previewReasonCode: string | undefined;
}): boolean {
  return input.agentIntent === "ON"
    && input.hasPendingLoopWork === true
    && input.previewStarted === false
    && input.previewReasonCode === "preview_start_missing";
}
