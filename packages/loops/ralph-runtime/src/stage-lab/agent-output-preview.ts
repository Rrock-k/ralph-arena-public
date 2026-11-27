export const AGENT_OUTPUT_PREVIEW_MAX_CHARS = 2_000 as const;

export function buildAgentOutputPreview(
  output: string,
  maxChars = AGENT_OUTPUT_PREVIEW_MAX_CHARS,
): {
  outputPreview: string | null;
  outputPreviewTruncated: boolean;
} {
  const normalized = output.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return {
      outputPreview: null,
      outputPreviewTruncated: false,
    };
  }

  if (normalized.length <= maxChars) {
    return {
      outputPreview: normalized,
      outputPreviewTruncated: false,
    };
  }

  const suffix = '\n... (truncated)';
  const bodyMaxChars = Math.max(0, maxChars - suffix.length);
  return {
    outputPreview: `${normalized.slice(0, bodyMaxChars).trimEnd()}${suffix}`,
    outputPreviewTruncated: true,
  };
}
