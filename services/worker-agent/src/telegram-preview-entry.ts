export function buildTelegramPreviewEntryUrl(
  governancePublicUrl: string | null | undefined,
  projectId: string | null | undefined,
): string {
  const base = governancePublicUrl?.trim().replace(/\/+$/, "") ?? "";
  const id = projectId?.trim() ?? "";
  if (!base || !id) return "";

  try {
    const baseUrl = new URL(base);
    if (baseUrl.protocol !== "https:") return "";
    if (
      baseUrl.hostname === "localhost"
      || baseUrl.hostname === "127.0.0.1"
      || baseUrl.hostname === "::1"
      || baseUrl.hostname.endsWith(".local")
      || baseUrl.hostname.endsWith(".localhost")
      || baseUrl.hostname === "governance-platform"
      || baseUrl.hostname === "governance"
    ) {
      return "";
    }

    const url = new URL("/api/auth/telegram-preview-entry", baseUrl);
    url.searchParams.set("projectId", id);
    return url.toString();
  } catch {
    return "";
  }
}
