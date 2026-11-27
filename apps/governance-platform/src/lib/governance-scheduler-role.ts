export const GOVERNANCE_SCHEDULER_ROLES = ["active", "standby", "external"] as const;

export type GovernanceSchedulerRole = typeof GOVERNANCE_SCHEDULER_ROLES[number];

export type GovernanceSchedulerDecision = {
  role: GovernanceSchedulerRole | null;
  enabled: boolean;
  source: "GOVERNANCE_SCHEDULER_ROLE";
  blocker: "missing_scheduler_role" | "invalid_scheduler_role" | null;
};

const schedulerRoles = new Set<string>(GOVERNANCE_SCHEDULER_ROLES);

export function resolveGovernanceScheduler(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceSchedulerDecision {
  const rawRole = env.GOVERNANCE_SCHEDULER_ROLE?.trim();

  if (!rawRole) {
    return {
      role: null,
      enabled: false,
      source: "GOVERNANCE_SCHEDULER_ROLE",
      blocker: "missing_scheduler_role",
    };
  }

  if (!schedulerRoles.has(rawRole)) {
    return {
      role: null,
      enabled: false,
      source: "GOVERNANCE_SCHEDULER_ROLE",
      blocker: "invalid_scheduler_role",
    };
  }

  const role = rawRole as GovernanceSchedulerRole;
  return {
    role,
    enabled: role === "active",
    source: "GOVERNANCE_SCHEDULER_ROLE",
    blocker: null,
  };
}
