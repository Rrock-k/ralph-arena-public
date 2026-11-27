"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { formatAgentLabel } from "@/lib/agent-labels-shared";
import { PreviewIframe } from "@/components/preview/PreviewIframe";

const MONITOR_W = 1280;
const MONITOR_H = 800;

interface BrutalistPreviewProps {
  title: string;
  previewUrl: string | null;
  href: string;
  agent: string;
  agentImpl?: string;
  model?: string | null;
  status: string;
  description?: string;
}

export function BrutalistPreview({
  title,
  previewUrl,
  href,
  agent,
  agentImpl,
  model,
  status,
  description,
}: BrutalistPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / MONITOR_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const statusLabel =
    status === "BUILDING"
      ? "BUILDING..."
      : status === "DEPLOYED"
        ? "LIVE"
        : status === "FAILED"
          ? "FAIL"
          : status;

  return (
    <div style={{ border: "1px solid #999", background: "#fff", fontSize: 11 }}>
      {/* Title bar */}
      <div
        style={{
          borderBottom: "1px solid #ccc",
          padding: "3px 6px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#f0f0f0",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
          <b>{title}</b>{" "}
          <small style={{ color: "#888" }}>[{formatAgentLabel(agent, agentImpl, model)}]</small>
        </span>
        <span
          style={{
            fontFamily: "Courier New, monospace",
            fontSize: 10,
            fontWeight: "bold",
            color:
              status === "BUILDING"
                ? "#b45309"
                : status === "DEPLOYED"
                  ? "#15803d"
                  : status === "FAILED"
                    ? "#dc2626"
                    : "#666",
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Preview area */}
      <Link href={href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        <div
          ref={containerRef}
          style={{
            position: "relative",
            aspectRatio: "16 / 9",
            background: "#e8e8e8",
            overflow: "hidden",
          }}
        >
          {previewUrl ? (
            <PreviewIframe
              previewUrl={previewUrl}
              proposalTitle={title}
              iframeClassName="pointer-events-none"
              iframeStyle={{
                position: "absolute",
                top: 0,
                left: 0,
                border: 0,
                width: MONITOR_W,
                height: MONITOR_H,
                transformOrigin: "top left",
                transform: `scale(${scale})`,
              }}
              fallbackClassName="flex h-full w-full items-center justify-center px-4 text-center font-mono text-[11px] text-[#999]"
              loading="lazy"
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                fontFamily: "Courier New, monospace",
                fontSize: 11,
                color: "#999",
              }}
            >
              {status === "BUILDING" ? "building..." : status === "FAILED" ? "build failed" : "waiting..."}
            </div>
          )}
        </div>
      </Link>

      {/* Footer */}
      <div style={{ borderTop: "1px solid #ccc", padding: "3px 6px" }}>
        {description && (
          <div style={{ color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {description}
          </div>
        )}

        <div style={{ marginTop: 2 }}>
          <Link href={href} style={{ color: "#0000EE" }}>open</Link>
        </div>
      </div>
    </div>
  );
}
