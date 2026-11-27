"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { deleteProject } from "@/app/actions/project-manage";

interface ProjectDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  proposalTitle: string;
}

export function ProjectDeleteDialog({
  open,
  onOpenChange,
  projectId,
  proposalTitle,
}: ProjectDeleteDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [removeDocker, setRemoveDocker] = useState(true);
  const [removeWorkspace, setRemoveWorkspace] = useState(true);

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteProject(projectId, { removeDocker, removeWorkspace });
      if (result.success) {
        toast.success("Project deleted");
        onOpenChange(false);
      } else {
        toast.error(result.error || "Delete failed");
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the project for &ldquo;{proposalTitle}&rdquo; along with
            all its specs and history. The proposal itself will remain. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <p className="text-sm text-gray-600">
            If this project has a provisioned VPS, it will also be destroyed automatically.
          </p>
          <label className="flex items-center gap-2.5 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              checked={removeDocker}
              onChange={(e) => setRemoveDocker(e.target.checked)}
              disabled={isPending}
              className="h-4 w-4 rounded border-gray-300 accent-rose-600"
            />
            Stop and remove Docker container
          </label>
          <label className="flex items-center gap-2.5 text-sm text-gray-700 select-none">
            <input
              type="checkbox"
              checked={removeWorkspace}
              onChange={(e) => setRemoveWorkspace(e.target.checked)}
              disabled={isPending}
              className="h-4 w-4 rounded border-gray-300 accent-rose-600"
            />
            Delete workspace files
          </label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
