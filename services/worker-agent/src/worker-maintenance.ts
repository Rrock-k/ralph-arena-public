export type WorkerMaintenanceController = {
  delayMs: number;
  isRestartScheduled(): boolean;
  requestSelfRestart(reason?: string): {
    status: "scheduled" | "already_scheduled";
    delayMs: number;
  };
};

type TimerHandleLike = {
  unref?: () => void;
};

type WorkerMaintenanceControllerOptions = {
  delayMs?: number;
  shutdownImpl?: () => void;
  scheduleImpl?: (callback: () => void, delayMs: number) => TimerHandleLike | void;
  log?: (message: string) => void;
};

const DEFAULT_RESTART_DELAY_MS = 250;

function normalizeDelayMs(input: number | undefined): number {
  if (!Number.isFinite(input)) {
    return DEFAULT_RESTART_DELAY_MS;
  }
  return Math.max(25, Math.trunc(input as number));
}

export function createWorkerMaintenanceController(
  opts: WorkerMaintenanceControllerOptions = {},
): WorkerMaintenanceController {
  const delayMs = normalizeDelayMs(opts.delayMs);
  const shutdownImpl = opts.shutdownImpl ?? (() => process.exit(0));
  const scheduleImpl = opts.scheduleImpl ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const log = opts.log ?? (() => {});

  let restartScheduled = false;

  return {
    delayMs,
    isRestartScheduled() {
      return restartScheduled;
    },
    requestSelfRestart(reason = "manual_restart") {
      if (restartScheduled) {
        return { status: "already_scheduled" as const, delayMs };
      }

      restartScheduled = true;
      log(`[worker-agent] Scheduling self restart (${reason}) in ${delayMs}ms`);
      const handle = scheduleImpl(() => {
        shutdownImpl();
      }, delayMs);
      handle?.unref?.();

      return { status: "scheduled" as const, delayMs };
    },
  };
}
