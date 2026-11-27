"use client";

import { useCallback, useRef, useState } from "react";
import { buildProjectWorkspaceLabel } from "@/lib/project-identity";

interface WorkspacePanelProps {
  projectId: string;
  projectName: string;
  projectSlug?: string | null;
  repoUrl?: string | null;
  commitSha?: string | null;
  workerHost?: string | null;
  workspaceRoot?: string;
}

const EDITORS = [
  { id: "vscode", label: "VS Code", href: (p: string) => `vscode://file${p}?windowId=_blank` },
  { id: "cursor", label: "Cursor", href: (p: string) => `cursor://file${p}?windowId=_blank` },
  { id: "antigravity", label: "Antigravity", href: (p: string) => `antigravity://file${p}` },
] as const;

export function WorkspacePanel({
  projectId,
  projectName,
  projectSlug,
  repoUrl,
  commitSha,
  workerHost,
  workspaceRoot,
}: WorkspacePanelProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const copy = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    } catch { /* ignore */ }
  }, []);

  const workspaceLabel = buildProjectWorkspaceLabel({ id: projectId, name: projectName, slug: projectSlug });
  const workingBranch = `arena/project-${projectId}`;
  const isLocal = !workerHost || workerHost === "local";
  // Absolute mount path for local — used for copy + open-in-editor
  const mountPath = isLocal && workspaceRoot ? `${workspaceRoot}/${workspaceLabel}` : null;

  return (
    <div className="space-y-2">
      {/* Mount path (local only) */}
      {mountPath && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Mount</span>
          <div className="flex items-center gap-1">
            <span className="mono max-w-[180px] truncate text-[11px] font-medium text-gray-700 dark:text-slate-200" title={mountPath}>
              {workspaceLabel}
            </span>
            <button
              onClick={() => copy("mount", mountPath)}
              className="text-[18px] leading-none text-gray-400 transition-colors hover:text-slate-200"
              title="Copy path"
            >
              {copiedKey === "mount" ? "✓" : "⎘"}
            </button>
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="text-[16px] leading-none text-gray-400 transition-colors hover:text-slate-200"
                title="Open in editor"
              >
                ⋯
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 rounded border border-slate-700 bg-slate-800 py-1 shadow-lg">
                    {EDITORS.map((ed) => (
                      <a
                        key={ed.id}
                        href={ed.href(mountPath)}
                        onClick={() => setMenuOpen(false)}
                        className="block whitespace-nowrap px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                      >
                        {ed.label}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Working branch */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-400 dark:text-slate-500">Branch</span>
        <button
          onClick={() => copy("branch", workingBranch)}
          className="mono max-w-[200px] truncate text-[11px] font-medium text-gray-700 transition-colors hover:text-emerald-600 dark:text-slate-200 dark:hover:text-emerald-400"
          title={`Click to copy: ${workingBranch}`}
        >
          {copiedKey === "branch" ? "Copied!" : workingBranch}
        </button>
      </div>

      {/* Commit SHA */}
      {commitSha && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 dark:text-slate-500">Commit</span>
          <button
            onClick={() => copy("sha", commitSha)}
            className="mono text-[11px] font-medium text-gray-700 transition-colors hover:text-emerald-600 dark:text-slate-200 dark:hover:text-emerald-400"
            title="Click to copy full SHA"
          >
            {copiedKey === "sha" ? "Copied!" : commitSha.slice(0, 8)}
          </button>
        </div>
      )}

      {/* Repo link */}
      {repoUrl && (
        <a
          href={repoUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-[11px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Repository ↗
        </a>
      )}
    </div>
  );
}
