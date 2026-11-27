import type { TerminalReport } from "./api.js";

function buildIdleYieldReport(reasonCode: string, reasonMessage: string): TerminalReport {
  return {
    terminalState: "CANCELED",
    reasonCode,
    reasonMessage,
    containerName: null,
    workerHost: null,
  };
}

export function buildIdleResumeReclaimReport(reasonMessage?: string): TerminalReport {
  return buildIdleYieldReport(
    "resume_reclaim",
    reasonMessage ?? "Idle preview yielded runtime so governance can reclaim and resume work.",
  );
}

export function buildIdlePreviewExitedReport(reasonMessage?: string): TerminalReport {
  return buildIdleYieldReport(
    "idle_preview_exited",
    reasonMessage ?? "Idle preview exited unexpectedly; governance should restore project truth through the normal claim path.",
  );
}

export function buildPausedRuntimeShutdownReport(reasonMessage?: string): TerminalReport {
  return buildIdleYieldReport(
    "paused_runtime_shutdown",
    reasonMessage ?? "Paused runtime shut down after governance requested shutdown.",
  );
}
