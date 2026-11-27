import { canonicalizeOpsStatus } from "@/lib/operator-display";

type LoopMigrationInput = {
  archivedAt?: string | Date | null;
  agentImpl?: string | null;
  useRepoHead?: boolean | null;
  loopVersion?: string | null;
  loopName?: string | null;
  lastOutcome?: string | null;
};

export type LoopMigrationState =
  | { visible: false }
  | {
      visible: true;
      disabled: boolean;
      hint?: string;
      warning: string;
      confirmMessage: string;
    };

function hasLoopIdentity(project: LoopMigrationInput): boolean {
  return Boolean(
    project.agentImpl?.trim() === "ralph" ||
    project.loopName?.trim() ||
    project.loopVersion?.trim(),
  );
}

function isRelaunchBlockedByActiveStatus(
  selectedProjectStatus: string,
  lastOutcome?: string | null,
): boolean {
  const status = canonicalizeOpsStatus(selectedProjectStatus);
  return (
    (status === "LIVE" || status === "BUILDING") && lastOutcome !== "FAILED"
  );
}

export function getOpsLoopMigrationState(
  project: LoopMigrationInput,
  selectedProjectStatus: string,
): LoopMigrationState {
  if (project.useRepoHead === true) return { visible: false };
  if (!hasLoopIdentity(project)) return { visible: false };

  const warning =
    "Restarts preview on the bundled default runtime. Agent restarts and turns on. Pre-launch checks still apply.";
  const confirmMessage =
    "Migrate this project to the bundled default runtime?\n\n" +
    "- Preview will restart\n" +
    "- Agent will restart and turn on\n" +
    "- Pre-launch checks still apply";

  if (project.archivedAt) {
    return {
      visible: true,
      disabled: true,
      hint: "Unarchive first",
      warning,
      confirmMessage,
    };
  }

  if (
    isRelaunchBlockedByActiveStatus(selectedProjectStatus, project.lastOutcome)
  ) {
    return {
      visible: true,
      disabled: true,
      hint: "Turn App OFF first",
      warning,
      confirmMessage,
    };
  }

  return {
    visible: true,
    disabled: false,
    warning,
    confirmMessage,
  };
}
