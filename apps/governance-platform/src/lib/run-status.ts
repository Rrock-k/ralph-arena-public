// Re-export from shared contracts
export {
  type TerminalStatus,
  isTerminalStatus,
  isActiveStatus,
} from "@arena/contracts";

// Legacy aliases (used in 3 files — remove when convenient)
export type { TerminalStatus as RunTerminalStatus } from "@arena/contracts";
export { isTerminalStatus as isRunTerminalStatus } from "@arena/contracts";
export { isActiveStatus as hasActiveRunStatus } from "@arena/contracts";
export function projectStatusFromTerminalRun(status: string): string {
  return status;
}
