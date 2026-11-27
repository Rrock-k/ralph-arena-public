"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateProposal } from "@/app/actions/proposal-manage";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const PROPOSAL_STATUSES = [
  { value: "PROPOSED", label: "Proposed" },
  { value: "PENDING_REVIEW", label: "Pending Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WINNER", label: "Winner" },
  { value: "NOT_SELECTED", label: "Not Selected" },
];

interface ProposalEditDialogProps {
  proposalId: string;
  proposal: {
    title: string;
    description: string;
    spec: string;
    status: string;
    seasonId: string | null;
  };
  seasons: Array<{ id: string; title: string; status: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProposalEditDialog({
  proposalId,
  proposal,
  seasons,
  open,
  onOpenChange,
}: ProposalEditDialogProps) {
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(proposal.title);
  const [description, setDescription] = useState(proposal.description);
  const [spec, setSpec] = useState(proposal.spec);
  const [status, setStatus] = useState(proposal.status);
  const [seasonId, setSeasonId] = useState(proposal.seasonId ?? "");

  function handleSubmit() {
    if (!title.trim()) {
      toast.error("Title cannot be empty");
      return;
    }

    startTransition(async () => {
      const result = await updateProposal(proposalId, {
        title,
        description,
        spec,
        status,
        seasonId: seasonId || null,
      });
      if (result.success) {
        toast.success("Proposal updated");
        onOpenChange(false);
      } else {
        toast.error(result.error || "Failed to update");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-gray-200 bg-white">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Edit proposal</DialogTitle>
          <DialogDescription className="text-gray-500">
            Update proposal details, status, and season assignment.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Proposal title"
              className="border-gray-200 bg-white text-gray-900 placeholder:text-gray-400"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description..."
              rows={3}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>

          {/* Spec */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Spec (markdown)</label>
            <textarea
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder="Detailed specification..."
              rows={8}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>

          {/* Status + Season */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              >
                {PROPOSAL_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Season</label>
              <select
                value={seasonId}
                onChange={(e) => setSeasonId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              >
                <option value="">No season</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.status})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </DialogBody>

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
            disabled={isPending || !title.trim()}
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
