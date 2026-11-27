export const PROJECT_FACING_AGENT_LOOP_INCLUDE = {
  currentVersion: {
    select: {
      id: true,
      version: true,
      capabilities: true,
      changelog: true,
      supportTier: true,
    },
  },
  loopTools: {
    select: {
      toolId: true,
      models: true,
      isDefault: true,
    },
  },
} as const;

export interface ProjectFacingLoopToolMapping {
  toolId: string;
  models: string | null;
  isDefault: boolean;
}

export interface ProjectFacingLoopVersion {
  id: string;
  version: string;
  capabilities: string[];
  changelog: string | null;
  supportTier: string | null;
}

export interface ProjectFacingAgentLoop {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  currentVersion: ProjectFacingLoopVersion | null;
  loopTools: ProjectFacingLoopToolMapping[];
}

export function toProjectFacingAgentLoops(
  loops: Array<{
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    currentVersion: ProjectFacingLoopVersion | null;
    loopTools: ProjectFacingLoopToolMapping[];
  }>,
): ProjectFacingAgentLoop[] {
  return loops.map((loop) => ({
    id: loop.id,
    name: loop.name,
    description: loop.description,
    isActive: loop.isActive,
    currentVersion: loop.currentVersion,
    loopTools: loop.loopTools,
  }));
}
