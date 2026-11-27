/**
 * RA-247: Public display status — what the user sees.
 *
 * Thin compatibility wrapper over the shared lifecycle projection.
 */

import {
  getAppComponent as getCanonicalAppComponent,
  getOpsDisplayStatus,
  type OperatorDisplayProject,
  type OperatorDisplayComponent,
} from "@/lib/operator-display";

type PublicStatus = "BUILDING" | "LIVE" | "PAUSED";

type ComponentState = OperatorDisplayComponent;
type ProjectWithOptionalComponent = OperatorDisplayProject;

export function getAppComponent(
  project: ProjectWithOptionalComponent,
): ComponentState | null {
  return getCanonicalAppComponent(project);
}

export function getDisplayStatus(
  project: ProjectWithOptionalComponent,
): PublicStatus {
  return getOpsDisplayStatus(project) as PublicStatus;
}

/** Is the project visually "active" (building or live)? */
export function isDisplayActive(
  project: ProjectWithOptionalComponent,
): boolean {
  return getDisplayStatus(project) !== "PAUSED";
}

/** @deprecated Use getDisplayStatus() directly */
export function isDisplayPaused(
  project: ProjectWithOptionalComponent,
): boolean {
  return getDisplayStatus(project) === "PAUSED";
}

/** @deprecated No longer applicable — cancel = archive */
export function isCancelInFlight(
  _project: ProjectWithOptionalComponent,
): boolean {
  return false;
}
