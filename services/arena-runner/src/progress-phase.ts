import type { PauseReason, TerminalStatus } from "@arena/contracts";

export function isVerificationLikeProgressState(state: string | null): boolean {
  return state === "testing" || state === "verification";
}

export type TerminalResultArtifact = {
  status: TerminalStatus;
  reason?: string;
  pauseReason?: PauseReason;
  retryAt?: string;
};

type TimeoutTerminalResolution = {
  terminalState: TerminalStatus;
  pauseReason?: PauseReason;
  reasonCode: "verification_timeout" | "general_idle_timeout";
  reasonMessage: string;
};

type TimeoutTerminalInput = {
  verificationTimedOut: boolean;
  generalIdleTimedOut: boolean;
  verificationIdleTimeoutMs: number;
  generalIdleTimeoutMs: number;
};

export function resolveTimeoutTerminalResolution({
  verificationTimedOut,
  generalIdleTimedOut,
  verificationIdleTimeoutMs,
  generalIdleTimeoutMs,
}: TimeoutTerminalInput): TimeoutTerminalResolution | null {
  if (verificationTimedOut) {
    return {
      terminalState: "FAILED",
      reasonCode: "verification_timeout",
      reasonMessage: `Verification timed out after ${Math.round(verificationIdleTimeoutMs / 60000)} minutes`,
    };
  }

  if (generalIdleTimedOut) {
    return {
      terminalState: "CANCELED",
      pauseReason: "INFRA",
      reasonCode: "general_idle_timeout",
      reasonMessage: `No activity for ${Math.round(generalIdleTimeoutMs / 60000)} minutes`,
    };
  }

  return null;
}

export function buildTerminalResultArtifact({
  terminalState,
  reasonMessage,
  pauseReason,
  retryAt,
}: {
  terminalState: TerminalStatus;
  reasonMessage?: string;
  pauseReason?: PauseReason;
  retryAt?: string;
}): TerminalResultArtifact {
  return {
    status: terminalState,
    ...(reasonMessage ? { reason: reasonMessage } : {}),
    ...(pauseReason ? { pauseReason } : {}),
    ...(retryAt ? { retryAt } : {}),
  };
}

export function shouldPersistTerminalResultArtifact(
  current: TerminalResultArtifact | null,
  next: TerminalResultArtifact,
): boolean {
  if (!current) return true;
  return current.status !== next.status
    || (current.reason ?? null) !== (next.reason ?? null)
    || (current.pauseReason ?? null) !== (next.pauseReason ?? null)
    || (current.retryAt ?? null) !== (next.retryAt ?? null);
}
