"use client";

import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { useLogStream } from "@/hooks/useLogStream";
import { LogView } from "./LogView";

interface RunLogViewerProps {
  projectId: string;
  initialLog?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Real-time log viewer dialog for projects.
 * Uses shared useLogStream hook for SSE streaming.
 */
export function RunLogViewer({ projectId, isOpen, onClose }: RunLogViewerProps) {
  const { lines, legacyText, isLegacy, connected, pinToBottom, setPinToBottom, containerRef, handleScroll } =
    useLogStream({ projectId, enabled: isOpen });
  const logsHref = `/admin?tab=logs&project=${encodeURIComponent(projectId)}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-2">
              <span>Project Logs</span>
              <span className="mono text-xs text-gray-400 dark:text-slate-500">{projectId.slice(-8)}</span>
              <span
                className={`ml-2 inline-flex h-2 w-2 rounded-full ${
                  connected ? "bg-emerald-400" : "bg-gray-300"
                }`}
                title={connected ? "Connected" : "Disconnected"}
              />
            </DialogTitle>
            <Link
              href={logsHref}
              onClick={onClose}
              className="shrink-0 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-100"
            >
              Open in Logs Page
            </Link>
          </div>
        </DialogHeader>
        <DialogBody>
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="max-h-[70vh] min-h-[300px] overflow-y-auto rounded-lg bg-gray-950 p-4"
          >
            <LogView lines={lines} legacyText={legacyText} isLegacy={isLegacy} />
          </div>
          {!pinToBottom && (
            <button
              onClick={() => {
                setPinToBottom(true);
                if (containerRef.current) {
                  containerRef.current.scrollTop = containerRef.current.scrollHeight;
                }
              }}
              className="absolute bottom-20 right-8 rounded border border-sky-500/50 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-sky-100 shadow-sm shadow-sky-950/20 transition-colors hover:border-sky-400/70 hover:bg-slate-800 hover:text-white"
            >
              Scroll to bottom
            </button>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
