/**
 * In-memory registry of active projects.
 * The dispatcher registers a project before starting the agent container,
 * and unregisters it after the project completes.
 */

export interface ProjectInfo {
  projectId: string;
  targetAnthropicUrl: string;
  targetOpenaiUrl: string;
  providerBillingMode?: string | null;
  registeredAt: Date;
}

const projects = new Map<string, ProjectInfo>();

export function registerProject(projectId: string, info: Omit<ProjectInfo, "registeredAt">): void {
  projects.set(projectId, { ...info, registeredAt: new Date() });
  console.log(`[api-proxy] Registered project ${projectId}`);
}

export function unregisterProject(projectId: string): void {
  projects.delete(projectId);
  console.log(`[api-proxy] Unregistered project ${projectId}`);
}

export function getProjectInfo(projectId: string): ProjectInfo | undefined {
  return projects.get(projectId);
}

export function getActiveProjectCount(): number {
  return projects.size;
}
