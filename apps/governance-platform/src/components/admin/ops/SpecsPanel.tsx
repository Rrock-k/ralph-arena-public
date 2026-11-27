"use client";

import { useState } from "react";
import { SpecEditor } from "../SpecEditor";
import type { ProjectAssetListItem } from "@/app/actions/assets";

interface SpecsPanelProps {
  projectId: string;
  specs: {
    id: string;
    title?: string | null;
    content: string;
    orderIndex: number;
  }[];
  assets?: Pick<ProjectAssetListItem, "id" | "path" | "originalName">[];
  canEdit?: boolean;
}

export function SpecsPanel({ projectId, specs, assets = [], canEdit = true }: SpecsPanelProps) {
  const [editSpec, setEditSpec] = useState<{ id: string; title: string | null; content: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-1">
      {specs.length > 0 ? (
        specs.map((spec) => (
          <button
            key={spec.id}
            type="button"
            onClick={() => {
              if (!canEdit) return;
              setEditSpec({ id: spec.id, title: spec.title ?? null, content: spec.content });
            }}
            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <svg className="h-3 w-3 shrink-0 text-gray-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="truncate">{spec.title || `Spec ${spec.orderIndex + 1}`}</span>
          </button>
        ))
      ) : (
        <span className="text-[11px] text-gray-400 dark:text-slate-500">No specs</span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-gray-400 hover:text-emerald-600 dark:text-slate-500 dark:hover:text-emerald-400"
        >
          <span>+ Add spec</span>
        </button>
      )}
      {canEdit && editSpec && <SpecEditor projectId={projectId} spec={editSpec} assets={assets} onClose={() => setEditSpec(null)} />}
      {canEdit && showAdd && <SpecEditor projectId={projectId} assets={assets} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
