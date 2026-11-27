"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { PreviewIframe } from "./PreviewIframe";

const MONITOR_W = 1280;
const MONITOR_H = 800;

interface PreviewButtonProps {
  previewUrl: string;
  proposalTitle: string;
  /** Project status — shows "Building..." overlay when app isn't expected to be live yet */
  status?: string;
  /** Project ID — used for auth handoff token */
  projectId?: string;
  /** Project visibility — featured projects allow guests but preserve identity when available */
  visibility?: "featured" | "public" | "private";
}

const BUILDING_STATUSES = new Set(["CREATED", "PROVISIONING", "QUEUED"]);

export function PreviewButton({
  previewUrl,
  proposalTitle,
  status,
  projectId,
  visibility,
}: PreviewButtonProps) {
  const [expanded, setExpanded] = useState(false);
  const [fixedStyle, setFixedStyle] = useState<React.CSSProperties | null>(null);
  const [placeholderH, setPlaceholderH] = useState(0);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const cardRef = useRef<HTMLElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const didRestoreFromUrl = useRef(false);

  const setPreviewParam = useCallback((open: boolean) => {
    const url = new URL(window.location.href);
    if (open) {
      url.searchParams.set("preview", "open");
    } else {
      url.searchParams.delete("preview");
    }
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") === "open" && !didRestoreFromUrl.current) {
      didRestoreFromUrl.current = true;
      setExpanded(true);
      setFixedStyle({
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 100,
        borderRadius: 0,
      });
      document.body.style.overflow = "hidden";
    }
  }, []);

  useEffect(() => {
    const el = monitorRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setDims({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isFullscreen = expanded && fixedStyle?.height === "100vh";
  const isMobileFullscreen = isFullscreen && dims.w > 0 && dims.w < 640;

  const scale = isMobileFullscreen
    ? 1
    : isFullscreen
      ? Math.min(dims.w / MONITOR_W, dims.h / MONITOR_H)
      : dims.w / MONITOR_W;

  const scaledW = MONITOR_W * scale;
  const scaledH = MONITOR_H * scale;
  const offsetX = isFullscreen && !isMobileFullscreen ? (dims.w - scaledW) / 2 : 0;
  const offsetY = isFullscreen && !isMobileFullscreen ? (dims.h - scaledH) / 2 : 0;

  const handleExpand = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPlaceholderH(rect.height);

    setFixedStyle({
      position: "fixed",
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      zIndex: 100,
      borderRadius: "0.75rem",
    });
    setExpanded(true);
    setPreviewParam(true);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFixedStyle({
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 100,
          borderRadius: 0,
          transition: "all 400ms cubic-bezier(0.32, 0.72, 0, 1)",
        });
        document.body.style.overflow = "hidden";
      });
    });
  }, [setPreviewParam]);

  const handleCollapse = useCallback(() => {
    const ph = placeholderRef.current;
    if (!ph) return;
    const rect = ph.getBoundingClientRect();

    setFixedStyle({
      position: "fixed",
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      zIndex: 100,
      borderRadius: "0.75rem",
      transition: "all 400ms cubic-bezier(0.32, 0.72, 0, 1)",
    });

    setTimeout(() => {
      setFixedStyle(null);
      setExpanded(false);
      setPreviewParam(false);
      document.body.style.overflow = "";
    }, 400);
  }, [setPreviewParam]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, handleCollapse]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <>
      {expanded && (
        <div
          ref={placeholderRef}
          style={{ height: placeholderH }}
          className="rounded-xl"
        />
      )}

      {expanded && (
        <div
          onClick={handleCollapse}
          className={`fixed inset-0 z-[99] bg-black/50 transition-opacity duration-400 ${
            isFullscreen ? "opacity-100" : "opacity-0"
          }`}
        />
      )}

      <section
        ref={cardRef}
        style={fixedStyle ?? undefined}
        className={`group overflow-hidden bg-gray-100 ${
          fixedStyle ? "" : "rounded-xl border border-gray-200"
        } ${expanded ? "flex flex-col" : ""}`}
      >
        {/* Header bar */}
        {isFullscreen ? (
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-3 py-2">
            <button
              type="button"
              onClick={handleCollapse}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close
            </button>
            <h1 className="truncate text-sm font-semibold text-gray-900">
              {proposalTitle}
            </h1>
            <div />
          </div>
        ) : (
          <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="mono text-[10px] text-emerald-600 font-bold">&gt;_</span>
              <span className="mono text-[10px] text-gray-500">preview</span>
            </div>
            <button
              type="button"
              onClick={handleExpand}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 transition-all hover:border-gray-900 hover:text-gray-900"
              aria-label="Expand preview"
              title="Expand preview"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 3H5a2 2 0 00-2 2v3m0 8v3a2 2 0 002 2h3m8-18h3a2 2 0 012 2v3m0 8v3a2 2 0 01-2 2h-3"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Monitor area */}
        <div
          ref={monitorRef}
          className={`relative overflow-hidden bg-gray-100 ${
            isFullscreen ? "flex-1" : "aspect-[16/10] cursor-pointer"
          }`}
          onClick={!isFullscreen ? handleExpand : undefined}
        >
          <>
            <PreviewIframe
              previewUrl={previewUrl}
              proposalTitle={proposalTitle}
              projectId={projectId}
              visibility={visibility}
              iframeClassName={`border-0 origin-top-left ${isFullscreen ? "" : "pointer-events-none"}`}
              iframeStyle={isMobileFullscreen ? {
                width: "100%",
                height: "100%",
              } : {
                width: MONITOR_W,
                height: MONITOR_H,
                transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
              }}
              fallbackClassName="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center"
              loading="lazy"
            />

            {/* Building overlay — shown when app isn't expected to be live yet */}
            {status && BUILDING_STATUSES.has(status) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0a]">
                <div className="animate-spin text-2xl text-gray-400 mb-3">&#9881;</div>
                <p className="text-sm font-medium text-gray-300">Agent is working...</p>
                <p className="text-xs text-gray-500 mt-1">Preview will appear here when the app is ready</p>
              </div>
            )}
          </>

          {/* Hover overlay — collapsed only */}
          {!isFullscreen && !BUILDING_STATUSES.has(status ?? "") && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-300 group-hover:bg-black/20 pointer-events-none">
              <span className="mono text-sm font-semibold text-white opacity-0 transition-all duration-300 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0">
                Expand Preview &#8599;
              </span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
