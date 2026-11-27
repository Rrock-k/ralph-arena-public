/**
 * PreviewCardDark — Terminal / HUD style card for active proposals (dark theme).
 * Used by /old and /retro legacy routes.
 */
"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import type { ProposalCardProps } from "@/components/ui/project-card/types";
import { getPreviewStage, getStageStyle } from "@/components/ui/project-card/types";
import { formatAgentLabel } from "@/lib/agent-labels-shared";
import { PreviewIframe } from "@/components/preview/PreviewIframe";

const MONITOR_W = 1280;
const MONITOR_H = 800;

export function PreviewCardDark({ proposal, project: projectOverride }: ProposalCardProps) {
  const project = projectOverride ?? proposal.projects?.[0];
  const previewUrl = project?.previewUrl ?? null;
  const stage = getPreviewStage(proposal, project);
  const stageStyle = stage ? getStageStyle(stage) : null;
  const detailHref = project ? `/projects/${project.id}` : `/proposals/${proposal.id}`;

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

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-[#080a10] p-3 sm:p-4 transition-all hover:border-emerald-500/20">
      {/* Terminal-style preview frame */}
      <Link href={detailHref} className="block">
        <div className="relative overflow-hidden rounded-lg border border-white/[0.08] transition-all duration-500 group-hover:border-emerald-500/25 group-hover:shadow-lg group-hover:shadow-emerald-500/5">
          {/* Terminal title bar */}
          <div className="flex items-center justify-between bg-[#0d1017] px-3 py-1.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="mono text-[10px] text-emerald-500/80 font-bold">&gt;_</span>
              <span className="mono text-[10px] text-slate-500">preview</span>
            </div>
            {stageStyle && (
              <div className={`flex items-center gap-1.5 ${stage === "starting" || stage === "building" ? "animate-pulse" : ""}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${stageStyle.dot}`} />
                <span className={`mono text-[9px] font-semibold ${stageStyle.text}`}>{stage}</span>
              </div>
            )}
          </div>

          {/* Preview screen */}
          <div ref={containerRef} className="relative aspect-[16/10] bg-[#060810] overflow-hidden">
            {previewUrl ? (
              <PreviewIframe
                previewUrl={previewUrl}
                proposalTitle={proposal.title}
                projectId={project?.id}
                visibility={project?.visibility}
                iframeClassName="border-0 pointer-events-none origin-top-left"
                iframeStyle={{
                  width: MONITOR_W,
                  height: MONITOR_H,
                  transform: `scale(${scale})`,
                }}
                fallbackClassName="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-slate-400"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-emerald-500/20 border-t-emerald-400 animate-spin" />
              </div>
            )}
            {/* Corner brackets */}
            <div className="absolute left-1.5 top-1.5 h-3 w-3 border-l border-t border-emerald-500/20 rounded-tl-sm" />
            <div className="absolute right-1.5 top-1.5 h-3 w-3 border-r border-t border-emerald-500/20 rounded-tr-sm" />
            <div className="absolute bottom-1.5 left-1.5 h-3 w-3 border-b border-l border-emerald-500/20 rounded-bl-sm" />
            <div className="absolute bottom-1.5 right-1.5 h-3 w-3 border-b border-r border-emerald-500/20 rounded-br-sm" />

            {/* Scanline overlay */}
            <div
              className="absolute inset-0 pointer-events-none opacity-[0.015]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.04) 4px)",
              }}
            />

            {/* Hover CTA */}
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all duration-300 group-hover:bg-black/30">
              <span className="mono text-sm font-semibold text-white opacity-0 transition-all duration-300 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0">
                {project ? "Open Project" : "Open Proposal"} &#8599;
              </span>
            </div>
          </div>
        </div>
      </Link>

      {/* Info row */}
      <div className="mt-3">
        <Link href={detailHref}>
          <h3 className="truncate text-sm font-bold text-slate-100 transition-colors hover:text-emerald-300">
            {proposal.title}
          </h3>
        </Link>
        {project && (
          <p className="mt-0.5 truncate text-xs text-slate-500 mono">
            {formatAgentLabel(project.agent, project.agentImpl, project.model)}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs text-slate-600">
          {proposal.description}
        </p>
      </div>
    </article>
  );
}
