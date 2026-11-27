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
import { ProposalEditDialog } from "./ProposalEditDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { archiveProposal, unarchiveProposal } from "@/app/actions/archive";
import { deleteProposal } from "@/app/actions/proposal-manage";

interface ProposalContextMenuProps {
  proposalId: string;
  proposal: {
    title: string;
    description: string;
    spec: string;
    status: string;
    seasonId: string | null;
  };
  seasons: Array<{ id: string; title: string; status: string }>;
  isArchived: boolean;
}

export function ProposalContextMenu({ proposalId, proposal, seasons, isArchived }: ProposalContextMenuProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isArchiving, startArchiveTransition] = useTransition();

  function handleArchiveToggle() {
    startArchiveTransition(async () => {
      const result = isArchived
        ? await unarchiveProposal(proposalId)
        : await archiveProposal(proposalId);
      if (result.success) {
        toast.success(isArchived ? "Proposal unarchived" : "Proposal archived");
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
          <DropdownMenuItem onSelect={handleArchiveToggle} disabled={isArchiving}>
            {isArchiving ? (isArchived ? "Unarchiving..." : "Archiving...") : (isArchived ? "Unarchive" : "Archive")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            className="text-rose-600 focus:text-rose-700 focus:bg-rose-50"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProposalEditDialog
        proposalId={proposalId}
        proposal={proposal}
        seasons={seasons}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete proposal"
        description={`This will permanently delete "${proposal.title}" along with all its projects, runs, specs, and votes. This action cannot be undone.`}
        onConfirm={() => deleteProposal(proposalId)}
        successMessage="Proposal deleted"
      />
    </>
  );
}
