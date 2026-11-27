"use client";

import { useRef, useState, useTransition } from "react";
import { deleteProjectAssetAction, uploadProjectAsset, type ProjectAssetListItem } from "@/app/actions/assets";
import { toast } from "sonner";

interface ProjectAssetsSectionProps {
  projectId: string;
  assets: ProjectAssetListItem[];
  compact?: boolean;
  canEdit?: boolean;
}

const ACCEPTED_ASSET_TYPES = ".glb,.gltf,.obj,.fbx,.png,.jpg,.jpeg,.svg,.wav,.mp3,.ogg,.ttf,.woff,.woff2";

export function ProjectAssetsSection({
  projectId,
  assets,
  compact = false,
  canEdit = true,
}: ProjectAssetsSectionProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleUpload = (formData: FormData) => {
    startTransition(async () => {
      const result = await uploadProjectAsset(projectId, formData);
      if (result.success) {
        toast.success("Asset uploaded");
        formRef.current?.reset();
      } else {
        toast.error(result.error || "Failed to upload asset");
      }
    });
  };

  const handleDelete = (assetId: string) => {
    if (confirmDeleteId !== assetId) {
      setConfirmDeleteId(assetId);
      setTimeout(() => setConfirmDeleteId((id) => (id === assetId ? null : id)), 3000);
      return;
    }

    setDeletingId(assetId);
    setConfirmDeleteId(null);
    startTransition(async () => {
      const result = await deleteProjectAssetAction(projectId, assetId);
      setDeletingId(null);
      if (result.success) {
        toast.success("Asset deleted");
      } else {
        toast.error(result.error || "Failed to delete asset");
      }
    });
  };

  const copyPath = async (path: string) => {
    await navigator.clipboard.writeText(path);
    toast.success("Asset path copied");
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      {assets.length > 0 ? (
        <div className={compact ? "space-y-1" : "space-y-2"}>
          {assets.map((asset) => (
            <div
              key={asset.id}
              className={
                compact
                  ? "rounded border border-slate-700/60 bg-slate-900/60 p-2"
                  : "rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => copyPath(asset.path)}
                  className="min-w-0 text-left"
                  title="Copy asset path"
                >
                  <span className="mono block truncate text-xs font-semibold text-gray-900 dark:text-slate-100">
                    {asset.path}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-slate-400">
                    {asset.originalName} · {formatBytes(asset.sizeBytes)} · {asset.contentType || "unknown type"} · {formatDate(asset.createdAt)}
                    {asset.uploadedById ? ` · by ${asset.uploadedById}` : ""}
                  </span>
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleDelete(asset.id)}
                    disabled={isPending || deletingId === asset.id}
                    className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
                      confirmDeleteId === asset.id
                        ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                        : "border-gray-200 text-gray-500 hover:border-rose-200 hover:text-rose-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-rose-500/30 dark:hover:text-rose-400"
                    } disabled:opacity-50`}
                  >
                    {deletingId === asset.id ? "..." : confirmDeleteId === asset.id ? "Confirm" : "Delete"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-slate-400">No project assets yet.</p>
      )}

      {canEdit && (
        <form ref={formRef} action={handleUpload} className={compact ? "space-y-1.5" : "space-y-3"}>
          <input
            name="file"
            type="file"
            accept={ACCEPTED_ASSET_TYPES}
            required
            className="block w-full text-xs text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 hover:file:border-emerald-400 dark:text-slate-300 dark:file:border-slate-600 dark:file:bg-slate-800 dark:file:text-slate-200"
          />
          <input
            name="path"
            type="text"
            placeholder="Optional path, e.g. assets/models/tree.glb"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:border-emerald-400 hover:text-emerald-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
          >
            {isPending ? "Uploading..." : "+ Upload asset"}
          </button>
          {!compact && (
            <p className="text-xs text-gray-500 dark:text-slate-400">
              Reference uploaded files from specs as <code className="mono">assets/...</code>. The runner syncs them into the workspace.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString();
}
