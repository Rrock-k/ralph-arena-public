import type { PauseReason, TerminalStatus } from "@arena/contracts";

export type GovernanceStopResolution = {
  terminalState: TerminalStatus;
  reasonCode: string;
  pauseReason?: PauseReason;
  keepPreviewAlive?: boolean;
};

export type StopRequestArtifact = {
  reason: string;
  pauseReason?: PauseReason;
  interruption?: "manual";
};

export function resolveGovernanceStop(stopReason: string): GovernanceStopResolution {
  if (stopReason === "agent_off") {
    return {
      terminalState: "CANCELED",
      reasonCode: "agent_off",
      keepPreviewAlive: true,
    };
  }

  if (
    stopReason === "power_off"
    || stopReason === "status_archived"
    || stopReason === "not_found"
    || stopReason === "no_component"
  ) {
    return {
      terminalState: "CANCELED",
      reasonCode: stopReason,
    };
  }

  if (stopReason === "paused_secrets") {
    return {
      terminalState: "CANCELED",
      pauseReason: "SECRETS",
      reasonCode: "missing_secrets",
    };
  }

  if (stopReason === "paused_manual" || stopReason === "status_paused_manual") {
    return {
      terminalState: "CANCELED",
      pauseReason: "MANUAL",
      reasonCode: "paused_manual",
    };
  }

  if (stopReason === "budget_exhausted") {
    return {
      terminalState: "CANCELED",
      pauseReason: "BUDGET",
      reasonCode: "budget_exhausted",
    };
  }

  if (stopReason === "status_paused_rate_limit") {
    return {
      terminalState: "CANCELED",
      pauseReason: "RATE_LIMIT",
      reasonCode: "status_paused_rate_limit",
    };
  }

  if (stopReason === "status_paused_api") {
    return {
      terminalState: "CANCELED",
      pauseReason: "API",
      reasonCode: "status_paused_api",
    };
  }

  if (stopReason === "status_paused_infra") {
    return {
      terminalState: "CANCELED",
      pauseReason: "INFRA",
      reasonCode: "status_paused_infra",
    };
  }

  return {
    terminalState: "CANCELED",
    reasonCode: "stopped_by_governance",
  };
}

export function buildStopRequestArtifact(stopReason: string): StopRequestArtifact | null {
  if (stopReason === "agent_off") {
    return {
      reason: "agent_off",
      interruption: "manual",
    };
  }

  const resolved = resolveGovernanceStop(stopReason);
  if (!resolved.pauseReason) return null;
  return {
    reason: stopReason,
    pauseReason: resolved.pauseReason,
  };
}
