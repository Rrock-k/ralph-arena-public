"use client";

import { useState } from "react";

interface SubmitSpecFormProps {
  onSubmit?: (data: {
    title: string;
    description: string;
    instructions: string;
  }) => void;
  disabled?: boolean;
}

export function SubmitSpecForm({
  onSubmit,
  disabled = false,
}: SubmitSpecFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [expanded, setExpanded] = useState(false);

  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    instructions.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit?.({
      title: title.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
    });
    setTitle("");
    setDescription("");
    setInstructions("");
    setExpanded(false);
  };

  const handleCancel = () => {
    setExpanded(false);
    setTitle("");
    setDescription("");
    setInstructions("");
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-3 text-sm text-slate-400 transition-all hover:border-emerald-400/30 hover:bg-emerald-500/[0.03] hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        Propose a spec
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.03] p-4">
      <h4 className="mb-3 text-sm font-semibold text-emerald-300">
        New spec proposal
      </h4>
      <div className="space-y-3">
        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title — short feature name"
          className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition-colors focus:border-emerald-400/40"
        />

        {/* Description — for voters */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500">
            Description — why is this needed? (for voters)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explain why this feature matters to users..."
            rows={2}
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition-colors focus:border-emerald-400/40 resize-none"
          />
        </div>

        {/* Instructions — for agent */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-slate-500">
            Instructions — what should the agent build? (technical spec)
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Be specific: technologies, behavior, edge cases..."
            rows={3}
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition-colors focus:border-emerald-400/40 resize-none mono"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-600">
            Specs should be additive — new features or clarifications, not
            changes to existing requirements.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={handleCancel}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-all hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
