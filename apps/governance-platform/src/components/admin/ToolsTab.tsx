"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createTool, updateTool, deleteTool } from "@/app/actions/registry";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface ModelOption {
  id: string;
  label: string;
  model: string;
  envOverrides?: Record<string, string>;
}

interface ToolData {
  id: string;
  name: string;
  description: string | null;
  models: string | null; // JSON string
  defaultModelId: string | null;
  isActive: boolean;
}

interface ToolsTabProps {
  tools: ToolData[];
}

function parseModels(raw: string | null): ModelOption[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function ToolsTab({ tools }: ToolsTabProps) {
  const [editingTool, setEditingTool] = useState<ToolData | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {tools.length} tool{tools.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          + Add Tool
        </button>
      </div>

      <div className="space-y-2">
        {tools.map((tool) => {
          const models = parseModels(tool.models);
          return (
            <div
              key={tool.id}
              className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                      {tool.name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        tool.isActive
                          ? "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "border border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {tool.isActive ? "active" : "inactive"}
                    </span>
                  </div>
                  {tool.description && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                      {tool.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {models.map((m) => (
                      <span
                        key={m.id}
                        className={`rounded-md px-2 py-0.5 text-[10px] mono ${
                          m.id === tool.defaultModelId
                            ? "border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/25 dark:bg-violet-500/10 dark:text-violet-300"
                            : "border border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {m.label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setEditingTool(tool)}
                  className="rounded-lg border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:border-gray-400 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500"
                >
                  Edit
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {isCreateOpen && (
        <ToolFormDialog
          onClose={() => setIsCreateOpen(false)}
          mode="create"
        />
      )}
      {editingTool && (
        <ToolFormDialog
          tool={editingTool}
          onClose={() => setEditingTool(null)}
          mode="edit"
        />
      )}
    </div>
  );
}

function ToolFormDialog({
  tool,
  onClose,
  mode,
}: {
  tool?: ToolData;
  onClose: () => void;
  mode: "create" | "edit";
}) {
  const [name, setName] = useState(tool?.name ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");
  const [modelsJson, setModelsJson] = useState(
    tool?.models ? JSON.stringify(parseModels(tool.models), null, 2) : "[]"
  );
  const [defaultModelId, setDefaultModelId] = useState(tool?.defaultModelId ?? "");
  const [isActive, setIsActive] = useState(tool?.isActive ?? true);
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    // Validate JSON
    try {
      JSON.parse(modelsJson);
    } catch {
      toast.error("Invalid JSON in models field");
      return;
    }

    startTransition(async () => {
      const data = {
        name: name.trim(),
        description: description.trim() || null,
        models: modelsJson,
        defaultModelId: defaultModelId.trim() || null,
        isActive,
      };

      const result =
        mode === "create"
          ? await createTool(data)
          : await updateTool(tool!.id, data);

      if (result.success) {
        toast.success(mode === "create" ? "Tool created" : "Tool updated");
        onClose();
      } else {
        toast.error((result as any).error || "Failed");
      }
    });
  };

  const handleDelete = () => {
    if (!tool) return;
    startTransition(async () => {
      const result = await deleteTool(tool.id);
      if (result.success) {
        toast.success("Tool deleted");
        onClose();
      } else {
        toast.error((result as any).error || "Failed to delete");
      }
    });
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle className="text-gray-900 dark:text-slate-100">
            {mode === "create" ? "Create Tool" : `Edit: ${tool?.name}`}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="claude-code"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="Claude Code CLI (Anthropic)"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Default Model ID
            </label>
            <input
              value={defaultModelId}
              onChange={(e) => setDefaultModelId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="default"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Models (JSON)
            </label>
            <textarea
              value={modelsJson}
              onChange={(e) => setModelsJson(e.target.value)}
              rows={8}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded text-emerald-600"
            />
            <span className="text-sm text-gray-700 dark:text-slate-300">Active</span>
          </label>
        </DialogBody>

        <DialogFooter>
          {mode === "edit" && (
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="mr-auto rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-black dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-70 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
