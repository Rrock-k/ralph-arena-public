"use client";

import { useMemo, useState, useEffect, type CSSProperties } from "react";
import { isMixedContentPreviewUrl, isLocalPreviewUrl, isSubdomainPreviewUrl } from "@/lib/preview-url";

interface PreviewIframeProps {
  previewUrl: string;
  proposalTitle: string;
  iframeClassName: string;
  fallbackClassName: string;
  iframeStyle?: CSSProperties;
  projectId?: string;
  visibility?: "featured" | "public" | "private";
  loading?: "eager" | "lazy";
}

export function PreviewIframe({
  previewUrl,
  proposalTitle,
  iframeClassName,
  fallbackClassName,
  iframeStyle,
  projectId,
  loading,
}: PreviewIframeProps) {
  const [handoffCode, setHandoffCode] = useState<string | null>(null);

  // Preserve user identity when the platform can mint a preview handoff. Featured
  // guests still fall back to anonymous preview access when this request is not authorized.
  useEffect(() => {
    if (!projectId) return;
    fetch("/api/auth/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    })
      .then((r) => r.json())
      .then((data) => { if (data.code) setHandoffCode(data.code); })
      .catch(() => {});
  }, [projectId]);

  const embeddablePreviewUrl = useMemo(() => {
    const raw = previewUrl.trim();
    if (!handoffCode) return raw;
    try {
      const u = new URL(raw);
      u.searchParams.set("arena_token", handoffCode);
      return u.toString();
    } catch {
      return raw;
    }
  }, [previewUrl, handoffCode]);

  const mixedContentBlocked = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isMixedContentPreviewUrl(embeddablePreviewUrl, window.location.protocol);
  }, [embeddablePreviewUrl]);

  const localPreviewBlocked = useMemo(() => {
    if (typeof window === "undefined") return false;
    const onPublicOrigin =
      !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
      !window.location.hostname.endsWith(".localhost");
    return onPublicOrigin && isLocalPreviewUrl(embeddablePreviewUrl);
  }, [embeddablePreviewUrl]);

  if (localPreviewBlocked) {
    return (
      <div className={fallbackClassName}>
        <p className="max-w-2xl text-sm sm:text-base">
          Preview unavailable on public access.
        </p>
        <p className="text-xs text-gray-500 sm:text-sm">This preview runs on the developer machine only.</p>
      </div>
    );
  }

  if (mixedContentBlocked) {
    return (
      <div className={fallbackClassName}>
        <p className="max-w-2xl text-sm sm:text-base">
          Browser blocked embedded preview because this page is HTTPS, but preview URL is HTTP.
        </p>
        <p className="text-xs text-gray-500 sm:text-sm">Preview unavailable due to mixed content restrictions.</p>
      </div>
    );
  }

  // Subdomain preview URLs are already origin-isolated; omit allow-same-origin
  // so iframe content cannot access parent cookies/storage.
  const sandbox = isSubdomainPreviewUrl(previewUrl)
    ? "allow-scripts"
    : "allow-scripts allow-same-origin";

  return (
    <iframe
      src={embeddablePreviewUrl}
      className={iframeClassName}
      style={iframeStyle}
      title={`Preview of ${proposalTitle}`}
      sandbox={sandbox}
      loading={loading}
      data-preview-iframe="true"
    />
  );
}
