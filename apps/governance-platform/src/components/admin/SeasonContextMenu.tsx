"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { SeasonForm } from "./SeasonForm";
import { updateSeasonStatus, deleteSeason } from "@/app/actions/seasons";

const STATUS_TRANSITIONS: Record<string, { label: string; next: string } | null> = {
  DRAFT: { label: "Activate", next: "ACTIVE" },
  ACTIVE: { label: "Complete", next: "COMPLETED" },
  COMPLETED: { label: "Archive", next: "ARCHIVED" },
  ARCHIVED: null,
};

interface SeasonContextMenuProps {
  season: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    submissionStart: Date | null;
    buildStart: Date | null;
    buildDeadline: Date | null;
    maxWinners: number;
    _count: { proposals: number };
  };
}

export function SeasonContextMenu({ season }: SeasonContextMenuProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [, startTransition] = useTransition();

  const transition = STATUS_TRANSITIONS[season.status];

  function handleStatusChange() {
    if (!transition) return;
    startTransition(async () => {
      const result = await updateSeasonStatus(season.id, transition.next);
      if (result.success) {
        toast.success(`Season ${transition.label.toLowerCase()}d`);
      } else {
        toast.error(result.error || "Failed");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-lg border border-gray-200 p-1.5 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
            aria-label="Actions"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0zm6 0a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          {transition && (
            <DropdownMenuItem onSelect={handleStatusChange}>
              {transition.label}
            </DropdownMenuItem>
          )}
          {season.status === "DRAFT" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDeleteOpen(true)}
                className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SeasonForm
        open={editOpen}
        onOpenChange={setEditOpen}
        season={season}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete season"
        description={`This will permanently delete "${season.title}". Only draft seasons without proposals can be deleted.`}
        onConfirm={() => deleteSeason(season.id)}
        successMessage="Season deleted"
      />
    </>
  );
}
