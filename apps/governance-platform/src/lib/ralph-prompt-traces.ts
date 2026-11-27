import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parsePromptTraceLine,
  PROMPT_TRACE_RELATIVE_PATH,
  type PromptTraceEvent,
} from "../../../../packages/loops/ralph-runtime/src/prompts/trace";
import { getWorkspaceRoot } from "@/lib/control-plane";
import { buildProjectWorkspaceLabel } from "@/lib/project-identity";
import { prisma } from "@/lib/prisma";

export type { PromptTraceEvent };

export interface RalphPromptTraceRun {
  projectId: string;
  projectName: string;
  workspaceLabel: string;
  tracePath: string;
  eventCount: number;
  latestAt: string | null;
  events: PromptTraceEvent[];
  errors: string[];
}

export interface RalphPromptTraceMap {
  workspaceRoot: string;
  runs: RalphPromptTraceRun[];
}

type PromptTraceProject = {
  id: string;
  name: string | null;
  slug: string | null;
  updatedAt: Date;
  proposal: {
    title: string | null;
  } | null;
};

export async function getRalphPromptTraceMap(options: {
  projectLimit?: number;
  eventLimit?: number;
} = {}): Promise<RalphPromptTraceMap> {
  const projectLimit = options.projectLimit ?? 40;
  const eventLimit = options.eventLimit ?? 200;
  const workspaceRoot = getWorkspaceRoot();
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    take: projectLimit,
    select: {
      id: true,
      name: true,
      slug: true,
      updatedAt: true,
      proposal: {
        select: {
          title: true,
        },
      },
    },
  });

  const runs: RalphPromptTraceRun[] = [];

  for (const project of projects) {
    const workspaceLabel = buildProjectWorkspaceLabel({
      id: project.id,
      name: project.name,
      slug: project.slug,
      proposal: project.proposal,
    });
    const tracePath = path.join(
      workspaceRoot,
      workspaceLabel,
      PROMPT_TRACE_RELATIVE_PATH,
    );

    if (!existsSync(tracePath)) continue;

    const trace = await readRalphPromptTraceFile(tracePath, eventLimit);
    if (trace.events.length === 0 && trace.errors.length === 0) continue;

    runs.push({
      projectId: project.id,
      projectName: getTraceProjectName(project),
      workspaceLabel,
      tracePath,
      eventCount: trace.events.length,
      latestAt: trace.events[trace.events.length - 1]?.timestamp ?? null,
      events: trace.events,
      errors: trace.errors,
    });
  }

  return { workspaceRoot, runs };
}

export async function readRalphPromptTraceFile(
  tracePath: string,
  eventLimit = 200,
): Promise<{ events: PromptTraceEvent[]; errors: string[] }> {
  const raw = await readFile(tracePath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const events: PromptTraceEvent[] = [];
  const errors: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    try {
      events.push(parsePromptTraceLine(line, index + 1));
    } catch (error: any) {
      errors.push(error.message);
    }
  }

  return {
    events: events.slice(-eventLimit),
    errors,
  };
}

function getTraceProjectName(project: PromptTraceProject): string {
  return (
    project.name?.trim() ||
    project.proposal?.title?.trim() ||
    `Project ${project.id.slice(-6)}`
  );
}
