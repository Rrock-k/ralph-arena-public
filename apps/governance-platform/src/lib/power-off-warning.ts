function projectTarget(projectName?: string): string {
  return projectName ? ` for "${projectName}"` : "";
}

export function getPowerOffCopy(projectName?: string): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  return {
    title: "Turn off app",
    description: `Turn the app off${projectTarget(projectName)}. The preview will stop until you turn it back on.`,
    confirmLabel: "Turn Off App",
  };
}

export function getPowerOffWarningCopy(projectName?: string): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  return {
    title: "Turn off app and park agent",
    description: `Agent loop is still active${projectTarget(projectName)}. App Off will park it and stop the preview. The project will not fail and can resume later.`,
    confirmLabel: "Turn Off App",
  };
}

export function getPowerOffConfirmMessage(projectName?: string): string {
  const copy = getPowerOffWarningCopy(projectName);
  return `${copy.description}\n\nContinue?`;
}

export function getBatchPowerOffCopy(activeLoopCount: number, totalCount: number): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  const projectLabel = totalCount === 1 ? "project" : "projects";
  const previewLabel = totalCount === 1 ? "Its preview will stop" : "Their previews will stop";
  if (activeLoopCount > 0) {
    const activeLabel = activeLoopCount === 1
      ? "1 selected project still has an active agent loop."
      : `${activeLoopCount} selected projects still have active agent loops.`;
    return {
      title: `Turn off app for ${totalCount} ${projectLabel}`,
      description: `${activeLabel} App Off will park those loops and stop their previews. The projects will not fail and can resume later.`,
      confirmLabel: `Turn Off ${totalCount} ${projectLabel}`,
    };
  }

  return {
    title: `Turn off app for ${totalCount} ${projectLabel}`,
    description: `This will turn the app off for ${totalCount} ${projectLabel}. ${previewLabel} until you turn ${totalCount === 1 ? "it" : "them"} on again.`,
    confirmLabel: `Turn Off ${totalCount} ${projectLabel}`,
  };
}
