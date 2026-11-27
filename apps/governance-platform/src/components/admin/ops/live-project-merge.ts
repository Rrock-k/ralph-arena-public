import type { OpsProject } from "./OpsDashboard";

type MergeMode = "partial" | "full";

function stableStringify(project: OpsProject) {
  return JSON.stringify(project);
}

function preserveIfUnchanged(
  previous: OpsProject | undefined,
  next: OpsProject,
) {
  if (!previous) return next;
  return stableStringify(previous) === stableStringify(next) ? previous : next;
}

export function mergeOpsProjectSnapshots(
  current: OpsProject[],
  incoming: OpsProject[],
  options: {
    mode: MergeMode;
    requestedIds?: string[];
  },
): OpsProject[] {
  const currentMap = new Map(current.map((project) => [project.id, project]));
  const incomingMap = new Map(incoming.map((project) => [project.id, project]));

  if (options.mode === "full") {
    return incoming.map((project) => preserveIfUnchanged(currentMap.get(project.id), project));
  }

  const requestedIds = new Set(options.requestedIds ?? []);
  const merged: OpsProject[] = [];

  for (const project of current) {
    if (!requestedIds.has(project.id)) {
      merged.push(project);
      continue;
    }
    const next = incomingMap.get(project.id);
    if (next) {
      merged.push(preserveIfUnchanged(project, next));
      incomingMap.delete(project.id);
    }
  }

  for (const project of incoming) {
    if (!currentMap.has(project.id)) {
      merged.push(project);
    }
  }

  return merged;
}

export function shouldPollSelectedOpsProject(project: OpsProject | null | undefined): boolean {
  const app = project?.components?.find((component) => component.kind === "app");
  if (!app) return false;

  const blockers = Array.isArray(app.blockers) ? app.blockers : [];
  if (blockers.length > 0 || app.retryAt) return true;

  if (app.powerIntent === "OFF") {
    return app.runtimeState === "RUNNING";
  }

  if (app.powerIntent === "ON") {
    return app.runtimeState === "ABSENT";
  }

  return false;
}
