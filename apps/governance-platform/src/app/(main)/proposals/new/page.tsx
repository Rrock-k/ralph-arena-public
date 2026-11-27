"use client";

import { useState, useTransition } from "react";
import { createProposalAndRedirect } from "../actions/create-proposal";
import { toast } from "sonner";
import { mapCreateProposalErrorForPublic } from "@/lib/public-error-messages";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import Link from "next/link";

export default function NewProposalPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [spec, setSpec] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Client-side validation
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
      try {
        toast.loading("Creating proposal...");
        await createProposalAndRedirect({
          title,
          description,
          spec,
        });
        toast.dismiss();
        toast.success("Proposal created successfully!");
      } catch (err) {
        toast.dismiss();
        const rawError = err instanceof Error ? err.message : undefined;
        const errorMsg = mapCreateProposalErrorForPublic(rawError);
        setError(errorMsg);
        toast.error(errorMsg);
      }
    });
  };

  return (
    <main className="min-h-screen bg-white py-8 sm:py-12">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">New Proposal</h1>
          <p className="mt-2 text-gray-500">Describe a project idea and push it into the voting pipeline.</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 sm:p-6 lg:p-8">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan-500" />
            <span className="mono text-xs text-cyan-700">Stage 01 -- Submission</span>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 sm:p-4 sm:text-base">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            <div>
              <label
                htmlFor="title"
                className="mb-1 block text-sm font-medium text-gray-900"
              >
                Title
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 sm:px-4 sm:text-base"
                placeholder="Enter proposal title"
                disabled={isPending}
                required
              />
            </div>

            <div>
              <label
                htmlFor="description"
                className="mb-1 block text-sm font-medium text-gray-900"
              >
                Description
              </label>
              <input
                type="text"
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 sm:px-4 sm:text-base"
                placeholder="Brief description of the proposal"
                disabled={isPending}
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="spec"
                  className="block text-sm font-medium text-gray-900"
                >
                  Spec (Markdown)
                </label>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 sm:text-sm"
                  disabled={isPending}
                >
                  {showPreview ? "Edit" : "Preview"}
                </button>
              </div>

              {showPreview ? (
                <div className="w-full min-h-[300px] overflow-auto rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 sm:px-4">
                  <MarkdownRenderer content={spec} />
                </div>
              ) : (
                <textarea
                  id="spec"
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  rows={12}
                  className="mono w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 transition-all focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 sm:px-4 sm:text-sm"
                  placeholder="Enter detailed specification in markdown format..."
                  disabled={isPending}
                  required
                />
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2">
              <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-xl bg-black px-4 py-2 text-sm font-bold text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-6 sm:py-2.5 sm:text-base"
              >
                {isPending ? "Creating..." : "Create Proposal"}
              </button>
              <Link
                href="/"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-center text-sm font-medium text-gray-700 transition-all hover:border-black sm:w-auto sm:px-6 sm:py-2.5 sm:text-base"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
