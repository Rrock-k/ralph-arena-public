"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { DragEvent } from "react";
import { useRouter } from "next/navigation";
import { GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setExploreOrder } from "@/app/actions/project-settings";
import { sortExploreProjects } from "@/lib/explore-projects";
import { getProjectName } from "@/lib/project-identity";

type ExploreOrderProject = {
  id: string;
  name?: string | null;
  proposal?: {
    title?: string | null;
  } | null;
  visibility?: string | null;
  archivedAt?: string | Date | null;
  createdAt?: string | Date | null;
  exploreRank?: number | null;
};

function isExploreCandidate(project: ExploreOrderProject): boolean {
  if (project.archivedAt) return false;
  const visibility = project.visibility ?? "public";
  return visibility === "featured" || visibility === "public";
}

function idsKey(ids: string[]): string {
  return ids.join("\u0000");
}

function getVisibilityLabel(project: ExploreOrderProject): string {
  return project.visibility === "featured" ? "Featured" : "Public";
}

function shouldPlaceAfter(event: DragEvent<HTMLDivElement>): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  const parent = event.currentTarget.parentElement;
  const columnCount = parent
    ? getComputedStyle(parent).gridTemplateColumns.split(" ").filter(Boolean)
        .length
    : 1;

  if (columnCount > 1) {
    return event.clientX > rect.left + rect.width / 2;
  }

  return event.clientY > rect.top + rect.height / 2;
}

export function ExploreOrderManager({
  projects,
}: {
  projects: ExploreOrderProject[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const orderedProjects = useMemo(
    () => sortExploreProjects(projects.filter(isExploreCandidate)),
    [projects],
  );
  const projectById = useMemo(
    () => new Map(orderedProjects.map((project) => [project.id, project])),
    [orderedProjects],
  );
  const persistedIds = useMemo(
    () => orderedProjects.map((project) => project.id),
    [orderedProjects],
  );
  const persistedKey = idsKey(persistedIds);
  const [baselineIds, setBaselineIds] = useState<string[]>(persistedIds);
  const [draftIds, setDraftIds] = useState<string[]>(persistedIds);
  const draftKey = idsKey(draftIds);
  const isDirty = draftKey !== idsKey(baselineIds);
  const draftProjects = draftIds
    .map((projectId) => projectById.get(projectId))
    .filter((project): project is ExploreOrderProject => Boolean(project));

  useEffect(() => {
    setBaselineIds(persistedIds);
    setDraftIds(persistedIds);
  }, [persistedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function moveProject(sourceId: string, targetId: string, afterTarget: boolean) {
    if (sourceId === targetId) return;

    setDraftIds((current) => {
      if (!current.includes(sourceId)) return current;

      const withoutSource = current.filter((projectId) => projectId !== sourceId);
      const targetIndex = withoutSource.indexOf(targetId);
      if (targetIndex === -1) return current;

      const insertAt = afterTarget ? targetIndex + 1 : targetIndex;
      const next = [
        ...withoutSource.slice(0, insertAt),
        sourceId,
        ...withoutSource.slice(insertAt),
      ];
      return idsKey(next) === idsKey(current) ? current : next;
    });
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId) return;
    moveProject(sourceId, targetId, shouldPlaceAfter(event));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await setExploreOrder(draftIds);
      if (result.success) {
        setBaselineIds(draftIds);
        toast.success("Explore order saved");
        router.refresh();
      } else {
        toast.error(result.error ?? "Failed to save Explore order");
      }
    });
  }

  if (orderedProjects.length === 0) {
    return null;
  }

  return (
    <section className="mb-5 border-b border-gray-200 pb-5 dark:border-slate-800">
      <div className="mb-3 flex items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-950 dark:text-slate-100">
            Explore order
          </h2>
          <div className="text-xs text-gray-500 dark:text-slate-500">
            First page uses the top 9 live Explore projects.
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || isPending}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-gray-950 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
        >
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save order
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {draftProjects.map((project, index) => (
          <div
            key={project.id}
            draggable={!isPending}
            onDragStart={(event) => {
              setDraggedId(project.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", project.id);
            }}
            onDragEnter={(event) => handleDragOver(event, project.id)}
            onDragOver={(event) => handleDragOver(event, project.id)}
            onDrop={(event) => {
              event.preventDefault();
              setDraggedId(null);
            }}
            onDragEnd={() => setDraggedId(null)}
            className={`flex min-w-0 cursor-grab items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm shadow-sm transition-colors active:cursor-grabbing dark:bg-slate-900 ${
              draggedId === project.id
                ? "border-emerald-400 opacity-70 dark:border-emerald-500"
                : "border-gray-200 dark:border-slate-800"
            }`}
          >
            <GripVertical className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
            <span className="mono w-7 shrink-0 text-xs font-semibold text-gray-500 dark:text-slate-400">
              #{index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-slate-100">
              {getProjectName(project)}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                project.visibility === "featured"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
              }`}
            >
              {getVisibilityLabel(project)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
