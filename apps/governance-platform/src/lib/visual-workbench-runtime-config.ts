import type { RunnerRalphConfig } from "@arena/contracts";

const VISUAL_WORKBENCH_AUTOMATION_SERVE_COMMAND = "npm run visual-workbench";
const VISUAL_WORKBENCH_AUTOMATION_BASE_URL_ENV = "VISUAL_WORKBENCH_BASE_URL";
export const VISUAL_EVIDENCE_MODES = ["off", "required", "new_tasks_only"] as const;
export type VisualEvidenceMode = (typeof VISUAL_EVIDENCE_MODES)[number];

export type VisualWorkbenchEvidenceAutomationRuntimeConfig = {
  enabled: true;
  allowedServeCommands: [typeof VISUAL_WORKBENCH_AUTOMATION_SERVE_COMMAND];
  allowedBaseUrlEnv: [typeof VISUAL_WORKBENCH_AUTOMATION_BASE_URL_ENV];
};

export function buildVisualWorkbenchEvidenceAutomationRuntimeConfig(): VisualWorkbenchEvidenceAutomationRuntimeConfig {
  return {
    enabled: true,
    allowedServeCommands: [VISUAL_WORKBENCH_AUTOMATION_SERVE_COMMAND],
    allowedBaseUrlEnv: [VISUAL_WORKBENCH_AUTOMATION_BASE_URL_ENV],
  };
}

export function isVisualEvidenceMode(value: unknown): value is VisualEvidenceMode {
  return typeof value === "string" && (VISUAL_EVIDENCE_MODES as readonly string[]).includes(value);
}

export function buildRunnerRalphConfigFromRuntimeConfig(
  runtimeConfig: Record<string, unknown> | null,
): RunnerRalphConfig | null {
  const mode = readVisualEvidenceMode(runtimeConfig);
  if (mode === "off") return null;

  const automationConfig = readVisualWorkbenchEvidenceAutomationRuntimeConfig(
    runtimeConfig?.visualWorkbenchEvidenceAutomation,
  );
  if (!automationConfig) return null;

  return {
    visualWorkbench: {
      visualEvidenceMode: mode,
      executorCaptureShell: {
        mode: "allowlisted",
        allowedServeCommands: [VISUAL_WORKBENCH_AUTOMATION_SERVE_COMMAND],
        allowedBaseUrlEnv: [VISUAL_WORKBENCH_AUTOMATION_BASE_URL_ENV],
      },
    },
  };
}

function readVisualWorkbenchEvidenceAutomationRuntimeConfig(rawAutomation: unknown): VisualWorkbenchEvidenceAutomationRuntimeConfig | null {
  if (!rawAutomation || typeof rawAutomation !== "object" || Array.isArray(rawAutomation)) {
    throw new Error("Invalid visualWorkbenchEvidenceAutomation runtimeConfig: expected object.");
  }
  const automation = rawAutomation as Record<string, unknown>;
  if (automation.enabled !== true) return null;

  const allowedServeCommands = readStringArray(automation.allowedServeCommands);
  const allowedBaseUrlEnv = readStringArray(automation.allowedBaseUrlEnv);
  if (
    !arrayEquals(allowedServeCommands, [VISUAL_WORKBENCH_AUTOMATION_SERVE_COMMAND])
    || !arrayEquals(allowedBaseUrlEnv, [VISUAL_WORKBENCH_AUTOMATION_BASE_URL_ENV])
  ) {
    throw new Error("Invalid visualWorkbenchEvidenceAutomation runtimeConfig: expected first-party Workbench allowlist.");
  }

  return {
    enabled: true,
    allowedServeCommands: [VISUAL_WORKBENCH_AUTOMATION_SERVE_COMMAND],
    allowedBaseUrlEnv: [VISUAL_WORKBENCH_AUTOMATION_BASE_URL_ENV],
  };
}

export function readVisualEvidenceMode(runtimeConfig: unknown): VisualEvidenceMode {
  if (runtimeConfig == null) return "off";
  if (typeof runtimeConfig !== "object" || Array.isArray(runtimeConfig)) {
    throw new Error("Invalid visual evidence runtimeConfig: expected object.");
  }
  const config = runtimeConfig as Record<string, unknown>;
  const rawMode = config.visualEvidenceMode;
  if (isVisualEvidenceMode(rawMode)) return rawMode;
  if (rawMode !== undefined) {
    throw new Error("Invalid visualEvidenceMode runtimeConfig: expected off, required or new_tasks_only.");
  }
  if (config.visualWorkbenchEvidenceAutomation == null) return "off";
  return readVisualWorkbenchEvidenceAutomationRuntimeConfig(config.visualWorkbenchEvidenceAutomation) ? "required" : "off";
}

export function readVisualEvidenceModeReadback(runtimeConfig: unknown): {
  visualEvidenceMode: VisualEvidenceMode | null;
  visualEvidenceModeError: string | null;
} {
  try {
    return {
      visualEvidenceMode: readVisualEvidenceMode(runtimeConfig),
      visualEvidenceModeError: null,
    };
  } catch (error) {
    return {
      visualEvidenceMode: null,
      visualEvidenceModeError: error instanceof Error ? error.message : String(error),
    };
  }
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function arrayEquals(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
