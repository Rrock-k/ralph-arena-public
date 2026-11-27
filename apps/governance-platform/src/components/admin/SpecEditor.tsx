"use client";

import { useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import { createSpec, updateSpec } from "@/app/actions/specs";
import type { ProjectAssetListItem } from "@/app/actions/assets";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface SpecEditorProps {
  projectId: string;
  spec?: { id: string; title: string | null; content: string };
  assets?: Pick<ProjectAssetListItem, "id" | "path" | "originalName">[];
  onClose: () => void;
}

export function SpecEditor({ projectId, spec, assets = [], onClose }: SpecEditorProps) {
  const isEditing = !!spec;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(spec?.title ?? "");
  const [content, setContent] = useState(spec?.content ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const mentionAssets = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return assets
      .filter((asset) => asset.path.toLowerCase().includes(query) || asset.originalName.toLowerCase().includes(query))
      .slice(0, 8);
  }, [assets, mentionQuery]);

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error("Content is required");
      return;
    }

    setSaving(true);
    try {
      const result = isEditing
        ? await updateSpec(spec!.id, { title: title || undefined, content })
        : await createSpec(projectId, { title: title || undefined, content });

      if (result.success) {
        toast.success(isEditing ? "Spec updated" : "Spec created");
        onClose();
      } else {
        toast.error(result.error || "Failed to save spec");
      }
    } catch (err) {
      console.error("Spec save failed:", err);
      toast.error("Failed to save spec — try refreshing the page");
    } finally {
      setSaving(false);
    }
  };

  const updateMentionState = (value: string, cursor: number | null) => {
    if (!assets.length || cursor === null) {
      setMentionQuery(null);
      return;
    }
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([a-zA-Z0-9._/-]*)$/);
    setMentionQuery(match ? match[1].toLowerCase() : null);
  };

  const insertAssetPath = (assetPath: string) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? content.length;
    const beforeCursor = content.slice(0, cursor);
    const afterCursor = content.slice(cursor);
    const match = beforeCursor.match(/@([a-zA-Z0-9._/-]*)$/);
    const replaceStart = match ? cursor - match[0].length : cursor;
    const prefix = match ? "" : (beforeCursor.endsWith(" ") || beforeCursor.length === 0 ? "" : " ");
    const inserted = `${prefix}\`${assetPath}\``;
    const nextContent = `${content.slice(0, replaceStart)}${inserted}${afterCursor}`;
    const nextCursor = replaceStart + inserted.length;

    setContent(nextContent);
    setMentionQuery(null);
    setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-gray-900 dark:text-slate-100">
              {isEditing ? "Edit Spec" : "Add Spec"}
            </DialogTitle>
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                showPreview
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30"
                  : "bg-gray-50 text-gray-500 border border-gray-200 hover:text-gray-800 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600 dark:hover:text-slate-200"
              }`}
            >
              {showPreview ? "Edit" : "Preview"}
            </button>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Authentication Requirements"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Content (Markdown)
            </label>
            {showPreview ? (
              <div className="min-h-[200px] rounded-xl border border-gray-200 bg-gray-50 p-4 prose max-w-none dark:border-slate-600 dark:bg-slate-800 dark:prose-invert">
                <MarkdownRenderer content={content || "*No content yet*"} />
              </div>
            ) : (
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    updateMentionState(e.target.value, e.target.selectionStart);
                  }}
                  onKeyUp={(e) => updateMentionState(content, e.currentTarget.selectionStart)}
                  onClick={(e) => updateMentionState(content, e.currentTarget.selectionStart)}
                  placeholder="Write your spec in markdown..."
                  rows={12}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 focus:outline-none font-mono resize-y dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                {mentionAssets.length > 0 && (
                  <div className="absolute bottom-2 left-2 right-2 z-10 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-slate-900">
                    {mentionAssets.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => insertAssetPath(asset.path)}
                        className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                      >
                        <span className="mono truncate text-xs font-semibold text-gray-900 dark:text-slate-100">
                          {asset.path}
                        </span>
                        <span className="truncate text-[11px] text-gray-500 dark:text-slate-400">
                          {asset.originalName}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!showPreview && assets.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {assets.slice(0, 8).map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => insertAssetPath(asset.path)}
                    className="mono max-w-full truncate rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:border-emerald-400 hover:text-emerald-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
                  >
                    @{asset.path}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:border-black disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !content.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Add Spec"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
