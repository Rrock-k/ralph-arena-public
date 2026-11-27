/**
 * Unified status → CSS class mapping for badge/pill styling.
 *
 * Covers project statuses (CREATED, PROVISIONING, QUEUED, RUNNING, PAUSING,
 * BUILDING, PAUSED, DEPLOYED, FAILED, CANCELED) and proposal statuses
 * (PROPOSED).  Includes dark-mode variants.
 */
const TRANSITION = "transition-colors duration-300";

export function getStatusClasses(status: string): string {
  switch (status) {
    // --- proposal-level ---
    case "PROPOSED":
      return `${TRANSITION} border-blue-200 bg-blue-50 text-blue-700 dark:border-cyan-400/25 dark:bg-cyan-500/10 dark:text-cyan-300`;

    // --- pre-run ---
    case "CREATED":
      return `${TRANSITION} border-gray-200 bg-gray-50 text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300`;
    case "PROVISIONING":
    case "QUEUED":
      return `${TRANSITION} border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-300`;

    // --- active ---
    case "RUNNING":
    case "BUILDING":
    case "PAUSING":
      return `${TRANSITION} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300`;

    // --- paused ---
    case "PAUSED":
    case "AGENT_OFF":
      return `${TRANSITION} border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300`;

    // --- runtime (RA-192 derived) ---
    case "SLEEPING":
      return `${TRANSITION} border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/25 dark:bg-blue-500/10 dark:text-blue-300`;
    case "ARCHIVED":
      return `${TRANSITION} border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-600/30 dark:bg-slate-800 dark:text-slate-400`;

    // --- terminal ---
    case "DEPLOYED":
      return `${TRANSITION} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300`;
    case "FAILED":
      return `${TRANSITION} border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300`;
    case "CANCELED":
      return `${TRANSITION} border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-400/25 dark:bg-slate-500/10 dark:text-slate-300`;
    case "SKIPPED":
      return `${TRANSITION} border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-600/40 dark:bg-slate-800 dark:text-slate-400`;

    default:
      return `${TRANSITION} border-gray-200 bg-gray-50 text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300`;
  }
}
