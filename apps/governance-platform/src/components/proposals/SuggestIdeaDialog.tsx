"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProposal } from "@/app/(main)/proposals/actions/create-proposal";
import { mapCreateProposalErrorForPublic } from "@/lib/public-error-messages";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";

interface SuggestIdeaDialogProps {
  isAuthenticated: boolean;
  children: React.ReactNode;
}

export function SuggestIdeaDialog({
  isAuthenticated,
  children,
}: SuggestIdeaDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setSpec("");
    setShowPreview(false);
    setError("");
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!isAuthenticated && nextOpen) {
      toast.error("Sign in to suggest an idea");
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!title.trim()) {
      const msg = "Title is required";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!description.trim()) {
      const msg = "Description is required";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!spec.trim()) {
      const msg = "Spec is required";
      setError(msg);
      toast.error(msg);
      return;
    }

    startTransition(async () => {
      toast.loading("Creating idea...");
      const result = await createProposal({ title, description, spec });
      toast.dismiss();

      if (result.success) {
        toast.success("Idea submitted!");
        setOpen(false);
        resetForm();
        router.refresh();

        if (result.proposalId) {
          const pid = result.proposalId;
          setTimeout(() => {
            const el = document.getElementById(`proposal-${pid}`);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.classList.add("highlight-new");
              setTimeout(() => el.classList.remove("highlight-new"), 3000);
            }
          }, 600);
        }
      } else {
        const msg = mapCreateProposalErrorForPublic(result.error);
        setError(msg);
        toast.error(msg);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div onClick={() => handleOpenChange(true)} className="contents">
        {children}
      </div>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Suggest an Idea</DialogTitle>
          <DialogDescription>
            Describe your project idea. The community will vote on it.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <form id="suggest-idea-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="idea-title" className="mb-1 block text-sm font-medium text-gray-900">
                Title
              </label>
              <input
                type="text"
                id="idea-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                placeholder="What do you want built?"
                disabled={isPending}
              />
            </div>

            <div>
              <label htmlFor="idea-desc" className="mb-1 block text-sm font-medium text-gray-900">
                Description
              </label>
              <input
                type="text"
                id="idea-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                placeholder="Brief description of the idea"
                disabled={isPending}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="idea-spec" className="block text-sm font-medium text-gray-900">
                  Spec (Markdown)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-900"
                  disabled={isPending}
                >
                  {showPreview ? "Edit" : "Preview"}
                </button>
              </div>

              {showPreview ? (
                <div className="min-h-[200px] w-full overflow-auto rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                  <MarkdownRenderer content={spec} />
                </div>
              ) : (
                <textarea
                  id="idea-spec"
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  rows={8}
                  className="mono w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 transition-all focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                  placeholder="Detailed specification in markdown..."
                  disabled={isPending}
                />
              )}
            </div>
          </form>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-xl border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition-all hover:border-black"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="suggest-idea-form"
            disabled={isPending}
            className="rounded-xl bg-black px-5 py-2 text-sm font-bold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Submitting..." : "Submit Idea"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
