"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProjectDeleteDialog } from "./ProjectDeleteDialog";
import { AddCreditsButton } from "./AddCreditsButton";
import { RunLogViewer } from "./RunLogViewer";
import { archiveProject, unarchiveProject } from "@/app/actions/archive";
import { renameProject } from "@/app/actions/project-manage";
import { setAgentIntent } from "@/app/actions/agent-intent";
import { relaunchProject } from "@/app/actions/relaunch";
import { setPowerIntent } from "@/app/actions/power-intent";
import { requestProjectPreviewRefresh, requestProjectRuntimeRecreate } from "@/app/actions/runtime-maintenance";
import { togglePinned } from "@/app/actions/project-settings";
import { getPowerOffConfirmMessage } from "@/lib/power-off-warning";
import { hasLiveAgentLoop } from "@/lib/agent-loop-activity";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import {
  getProjectActions, groupedActions,
  type ProjectActionContext, type ProjectAction,
} from "./ProjectActions";

interface ProjectContextMenuProps extends ProjectActionContext {}

type RetryNowApiResult =
  | {
      success: true;
      projectId: string;
      blocker: string;
      remainingBlockers: string[];
      resumePath: "supervisor" | "claim";
    }
  | {
      success: false;
      error: string;
    };

async function retryProjectNowViaApi(projectId: string): Promise<RetryNowApiResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/retry-now`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => null) as Partial<RetryNowApiResult> | null;
  if (!response.ok || payload?.success !== true) {
    const error = payload && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "Retry now failed.";
    return {
      success: false,
      error,
    };
  }
  return payload as RetryNowApiResult;
}

export function ProjectContextMenu(props: ProjectContextMenuProps) {
  const { projectId, projectName } = props;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const actions = getProjectActions(props);
  const items = groupedActions(actions);
  const handlers = useActionHandlers(props, {
    setDeleteOpen, setCreditsOpen, setLogsOpen, setRenameOpen,
  }, {
    skipRefreshActions: ["relaunch", "agentOn", "agentOff", "archive", "unarchive", "refreshPreview", "recreateRuntime"],
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-lg border border-gray-200 bg-white/80 backdrop-blur-sm p-1.5 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
            aria-label="Actions"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((item, i) =>
            item === "separator" ? (
              <DropdownMenuSeparator key={`sep-${i}`} />
            ) : (
              <DropdownMenuItem
                key={item.id}
                onSelect={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  handlers[item.id]?.();
                }}
                className={item.className}
                disabled={item.disabled}
                title={item.disabledReason}
              >
                {item.label}
              </DropdownMenuItem>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <RunLogViewer projectId={projectId} isOpen={logsOpen} onClose={() => setLogsOpen(false)} />
      <AddCreditsButton projectId={projectId} externalOpen={creditsOpen} onExternalOpenChange={setCreditsOpen} />
      <ProjectDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} projectId={projectId} proposalTitle={projectName} />
      <RenameDialog open={renameOpen} onOpenChange={setRenameOpen} projectId={projectId} currentName={projectName} />
    </>
  );
}

/** Map action IDs to handler callbacks. Shared between dropdown and context menu. */
export function useActionHandlers(
  ctx: ProjectActionContext,
  dialogs: {
    setDeleteOpen: (v: boolean) => void;
    setCreditsOpen: (v: boolean) => void;
    setLogsOpen: (v: boolean) => void;
    setRenameOpen: (v: boolean) => void;
  },
  options?: {
    refresh?: boolean;
    skipRefreshActions?: string[];
    onSuccess?: () => void;
  },
): Record<string, () => void> {
  const router = useRouter();
  const shouldRefresh = options?.refresh ?? true;
  const skipRefreshActions = new Set(options?.skipRefreshActions ?? []);

  function handleSuccess(actionId: string, callback: () => void): void {
    callback();
    options?.onSuccess?.();
    if (shouldRefresh && !skipRefreshActions.has(actionId)) {
      router.refresh();
    }
  }

  return {
    logs: () => dialogs.setLogsOpen(true),
    rename: () => dialogs.setRenameOpen(true),
    copyId: () => {
      navigator.clipboard.writeText(ctx.projectId);
      toast.success("ID copied");
    },
    pin: () => {
      togglePinned(ctx.projectId, !ctx.project?.isPinned).then((result) => {
        if (result.success) {
          handleSuccess("pin", () => toast.success(ctx.project?.isPinned ? "Unpinned" : "Pinned"));
        } else {
          toast.error(result.error ?? "Failed");
        }
      });
    },
    relaunch: () => {
      relaunchProject(ctx.projectId).then((r) => { if (r?.error) toast.error(r.error); else handleSuccess("relaunch", () => toast.success("Relaunch queued")); });
    },
    agentOn: () => {
      setAgentIntent(ctx.projectId, "ON").then((r) => { if (r?.error) toast.error(r.error); else handleSuccess("agentOn", () => toast.success("Agent on")); });
    },
    agentOff: () => {
      setAgentIntent(ctx.projectId, "OFF").then((r) => { if (r?.error) toast.error(r.error); else handleSuccess("agentOff", () => toast.success("Agent off")); });
    },
    archive: () => {
      archiveProject(ctx.projectId).then((r) => { if (r?.error) toast.error(r.error); else handleSuccess("archive", () => toast.success("Archived")); });
    },
    unarchive: () => {
      unarchiveProject(ctx.projectId).then((r) => { if (r?.error) toast.error(r.error); else handleSuccess("unarchive", () => toast.success("Unarchived")); });
    },
    powerOff: () => {
      const primaryComponent = ctx.project ? getPrimaryLifecycleComponent(ctx.project) : null;
      if (hasLiveAgentLoop(primaryComponent) && !window.confirm(getPowerOffConfirmMessage(ctx.projectName))) {
        return;
      }
      setPowerIntent(ctx.projectId, "OFF").then((r) => { if (r?.error) toast.error(r.error); else handleSuccess("powerOff", () => toast.success("App off")); });
    },
    powerOn: () => {
      setPowerIntent(ctx.projectId, "ON").then((r) => { if (r?.error) toast.error(r.error); else handleSuccess("powerOn", () => toast.success("App start requested")); });
    },
    refreshPreview: () => {
      requestProjectPreviewRefresh(ctx.projectId).then((r) => {
        if (r?.error) toast.error(r.error);
        else handleSuccess("refreshPreview", () => toast.success(r.details || "Preview refresh requested"));
      });
    },
    recreateRuntime: () => {
      requestProjectRuntimeRecreate(ctx.projectId).then((r) => {
        if (r?.error) toast.error(r.error);
        else handleSuccess("recreateRuntime", () => toast.success(r.details || "Runtime recreate requested"));
      });
    },
    retryNow: () => {
      retryProjectNowViaApi(ctx.projectId).then((r) => {
        if (!r.success) toast.error(r.error);
        else handleSuccess("retryNow", () => toast.success("Retry requested"));
      }).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Retry now failed.");
      });
    },
    addCredits: () => dialogs.setCreditsOpen(true),
    delete: () => dialogs.setDeleteOpen(true),
  };
}

// ── Dialogs ──────────────────────────────────────────────

export function RenameDialog({ open, onOpenChange, projectId, currentName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentName: string;
}) {
  const [name, setName] = useState(currentName);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    startTransition(async () => {
      const result = await renameProject(projectId, name);
      if (result.success) {
        toast.success("Renamed");
        router.refresh();
        onOpenChange(false);
      } else {
        toast.error(result.error ?? "Failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="dark:text-slate-100">Rename Project</DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            This only changes the display name. Runtime identity stays the same.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          className="dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && name !== currentName) {
              e.preventDefault();
              handleSave();
            }
          }}
        />
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-slate-700 dark:text-slate-300">Cancel</button>
          <button onClick={handleSave} disabled={isPending || !name.trim() || name === currentName} className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white">{isPending ? "Saving..." : "Save"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
