"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { renameProposal } from "@/app/actions/proposal-manage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface RenameDialogProps {
  proposalId: string;
  currentTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameDialog({ proposalId, currentTitle, open, onOpenChange }: RenameDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (!title.trim()) {
      toast.error("Title cannot be empty");
      return;
    }
    startTransition(async () => {
      const result = await renameProposal(proposalId, title);
      if (result.success) {
        toast.success("Proposal renamed");
        onOpenChange(false);
      } else {
        toast.error(result.error || "Failed to rename");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename proposal</DialogTitle>
          <DialogDescription>Enter a new title for this proposal.</DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !isPending) handleSubmit(); }}
          autoFocus
          placeholder="Proposal title"
        />
        <DialogFooter>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-black"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white transition-shadow hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
