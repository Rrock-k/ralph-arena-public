export type SeasonPhase = "Open" | "Build" | null;

export interface SeasonLike {
  status: string;
  submissionStart: Date | string | null;
  buildStart: Date | string | null;
  buildDeadline: Date | string | null;
}

export function getCurrentPhase(season: SeasonLike): SeasonPhase {
  if (season.status !== "ACTIVE") return null;
  const now = new Date();

  const subStart = season.submissionStart ? new Date(season.submissionStart) : null;
  const bStart = season.buildStart ? new Date(season.buildStart) : null;
  const bEnd = season.buildDeadline ? new Date(season.buildDeadline) : null;

  // Exact match: within Open window
  if (subStart && bStart && now >= subStart && now < bStart) return "Open";
  // Exact match: within Build window
  if (bStart && bEnd && now >= bStart && now <= bEnd) return "Build";

  // Fallback for ACTIVE seasons outside exact windows:
  // Before build starts → still Open; after build starts → Build
  if (bStart && now < bStart) return "Open";
  if (bStart && now >= bStart) return "Build";

  // No dates at all but ACTIVE → default to Open
  return "Open";
}
