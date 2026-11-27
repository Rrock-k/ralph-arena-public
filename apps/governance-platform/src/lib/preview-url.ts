const DEPLOYMENTS_PREFIX = "/deployments/";
const PREVIEW_REDIRECT_PATH = "/api/auth/preview-redirect";
const LOCAL_PREVIEW_HOST_HINTS = ["localhost", "nip.io"];

function normalizeProtocol(rawProtocol: string): "http:" | "https:" | null {
  const value = rawProtocol.trim().toLowerCase();
  if (value === "http" || value === "http:") return "http:";
  if (value === "https" || value === "https:") return "https:";
  return null;
}

export function isValidPreviewUrl(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (!url) return false;

  if (url.startsWith(DEPLOYMENTS_PREFIX)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isMixedContentPreviewUrl(previewUrl: string, currentProtocol: string): boolean {
  const protocol = normalizeProtocol(currentProtocol);
  if (protocol !== "https:") {
    return false;
  }

  try {
    const parsed = new URL(previewUrl, `${protocol}//preview.local`);
    return parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Detect preview URLs that resolve only on the local machine.
 * Must not be rendered when governance is accessed from a public origin.
 */
export function isLocalPreviewUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl.trim()).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/**
 * Detect subdomain-based preview URLs (https://preview-*.domain).
 * These are origin-isolated and should be passed through as-is.
 */
export function isSubdomainPreviewUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "https:" && /^preview-[a-z0-9]/.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Build a canonical preview URL from a container name and the configured preview domain.
 * Returns null when the domain is unavailable so callers can preserve existing state.
 */
export function buildPreviewUrl(containerName: string): string | null {
  return buildPreviewUrlFromDomain(containerName, process.env.PREVIEW_DOMAIN?.trim() ?? null);
}

export function buildPreviewUrlFromDomain(containerName: string, previewDomain: string | null | undefined): string | null {
  const label = containerName.trim();
  const domain = previewDomain?.trim();

  if (!domain || !label) return null;

  const useHttp = LOCAL_PREVIEW_HOST_HINTS.some((hint) => domain.includes(hint));
  const scheme = useHttp ? "http" : "https";
  return `${scheme}://${label}.${domain}`;
}

type PreferredPreviewUrlInput = {
  previewUrl?: string | null;
  containerName?: string | null;
  previewDomain?: string | null;
};

/**
 * Prefer a public canonical preview host when stored previewUrl is missing or stale-local.
 * This keeps live UI honest without mutating project rows.
 */
export function getPreferredPreviewUrl({
  previewUrl,
  containerName,
  previewDomain,
}: PreferredPreviewUrlInput): string | null {
  const current = previewUrl?.trim() || null;
  if (current && !isLocalPreviewUrl(current)) {
    return current;
  }

  const canonical = containerName?.trim()
    ? buildPreviewUrlFromDomain(containerName, previewDomain)
    : null;

  return canonical ?? current;
}

export function getProjectPreviewOpenHref(
  projectId: string,
  publicBase?: string | null,
): string {
  const path = `${PREVIEW_REDIRECT_PATH}?projectId=${encodeURIComponent(projectId.trim())}`;
  const base = publicBase?.trim();
  if (!base) return path;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}
