import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  applyStateChange,
  requirePrimaryComponentRow,
  updateComponentMetadata,
} from "@/lib/project-state-effects";
import { getRetryableBlocker, type RetryableBlocker } from "@/lib/retry-backoff";
import { notifyProjectChanged, notifyProjectEvent } from "@/lib/progress-bus";

type RetryNowResult =
  | {
      success: true;
      projectId: string;
      blocker: RetryableBlocker | "MANUAL";
      remainingBlockers: string[];
      resumePath: "supervisor" | "claim";
    }
  | {
      success: false;
      error: string;
    };

export async function retryProjectNowInternal(projectId: string): Promise<RetryNowResult> {
  try {
    const result = await prisma.$transaction(async (tx): Promise<RetryNowResult> => {
      const row = await requirePrimaryComponentRow(tx, projectId);

      if (row.archivedAt) {
        return { success: false, error: "Archived projects cannot be retried." };
      }
      if (row.powerIntent !== "ON") {
        return { success: false, error: "Project app is OFF; turn App ON before retrying loop work." };
      }

      const blocker = getRetryableBlocker(row.blockers) ?? (row.blockers.includes("MANUAL") ? "MANUAL" : null);
      if (!blocker) {
        return {
          success: false,
          error: row.blockers.length > 0
            ? `No retryable or manual blocker is present. Current blockers: ${row.blockers.join(", ")}.`
            : "No blockers are present.",
        };
      }
      if (row.agentIntent !== "ON" && blocker !== "MANUAL") {
        return { success: false, error: "Project agent is OFF; turn Agent ON before retrying loop work." };
      }

      const remainingBlockers = row.blockers.filter((entry) => entry !== blocker);
      const resumePath = row.runtimeState === "RUNNING" ? "supervisor" : "claim";
      const ctx = {
        source: "admin" as const,
        trigger: "retry_now",
        reason: `operator retry now for ${blocker}`,
      };

      await applyStateChange(tx, projectId, { type: "removeBlocker", blocker }, ctx);
      await updateComponentMetadata(tx, projectId, {
        retryCount: row.retryCount + 1,
        retryAt: null,
      }, {
        ...ctx,
        reason: remainingBlockers.length > 0
          ? "operator_retry_now_remaining_blockers"
          : resumePath === "supervisor"
            ? "operator_retry_now_supervisor_resume"
            : "operator_retry_now_resume_claimable",
      });

      return {
        success: true,
        projectId,
        blocker,
        remainingBlockers,
        resumePath,
      };
    });

    if (result.success) {
      revalidatePath("/admin");
      revalidatePath(`/my/projects/${projectId}`);
      notifyProjectChanged(projectId);
      notifyProjectEvent(projectId, {
        type: "project_event",
        status: "RETRY_NOW",
      });
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown retry-now error",
    };
  }
}
