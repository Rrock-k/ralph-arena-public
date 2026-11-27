"use client";

import { useState } from "react";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import { SpecEditor } from "./SpecEditor";
import { deleteSpec } from "@/app/actions/specs";
import type { ProjectAssetListItem } from "@/app/actions/assets";
import { toast } from "sonner";

interface SpecItem {
  id: string;
  title: string | null;
  content: string;
  orderIndex: number;
  updatedAt: Date;
  versions?: Array<{ version: number; createdAt: Date }>;
}

interface SpecListProps {
  projectId: string;
  specs: SpecItem[];
  assets?: Pick<ProjectAssetListItem, "id" | "path" | "originalName">[];
  canEdit: boolean;
}

export function SpecList({ projectId, specs, assets = [], canEdit }: SpecListProps) {
  const [editorSpec, setEditorSpec] = useState<SpecItem | null>(null);
  const [showAddEditor, setShowAddEditor] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (specId: string) => {
    if (confirmDeleteId !== specId) {
      setConfirmDeleteId(specId);
      // Auto-reset after 3s
      setTimeout(() => setConfirmDeleteId((id) => (id === specId ? null : id)), 3000);
      return;
    }

    setDeletingId(specId);
    setConfirmDeleteId(null);
    const result = await deleteSpec(specId);
    setDeletingId(null);

    if (result.success) {
      toast.success("Spec deleted");
    } else {
      toast.error(result.error || "Failed to delete spec");
    }
  };

  return (
    <div>
      {specs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">No specs yet.</p>
      ) : (
        <div className="space-y-3">
          {specs.map((spec) => (
            <div
              key={spec.id}
              className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/50"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <h4 className="truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {spec.title || `Spec #${spec.orderIndex + 1}`}
                  </h4>
                  {spec.versions?.[0] && (
                    <span className="mono shrink-0 text-[10px] text-gray-500 dark:text-slate-400">
                      v{spec.versions[0].version}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditorSpec(spec)}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-emerald-400 hover:text-emerald-600 transition-colors dark:border-slate-600 dark:text-slate-300 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(spec.id)}
                      disabled={deletingId === spec.id}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                        confirmDeleteId === spec.id
                          ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                          : "border-gray-200 text-gray-500 hover:border-rose-200 hover:text-rose-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-rose-500/30 dark:hover:text-rose-400"
                      } disabled:opacity-50`}
                    >
                      {deletingId === spec.id
                        ? "..."
                        : confirmDeleteId === spec.id
                          ? "Confirm"
                          : "Delete"}
                    </button>
                  </div>
                )}
              </div>
              <div className="prose prose-sm max-w-none text-gray-600 dark:prose-invert dark:text-slate-300">
                <MarkdownRenderer content={spec.content} />
              </div>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={() => setShowAddEditor(true)}
          className="mt-3 rounded-xl border border-dashed border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-emerald-400 hover:text-emerald-600 w-full dark:border-slate-600 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
        >
          + Add Spec
        </button>
      )}

      {/* Edit modal */}
      {editorSpec && (
        <SpecEditor
          projectId={projectId}
          spec={editorSpec}
          assets={assets}
          onClose={() => setEditorSpec(null)}
        />
      )}

      {/* Add modal */}
      {showAddEditor && (
        <SpecEditor
          projectId={projectId}
          assets={assets}
          onClose={() => setShowAddEditor(false)}
        />
      )}
    </div>
  );
}
