import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerProjectVisualEvidenceArtifactCheckTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_visual_evidence_artifact_check", {
    description:
      "Check current visualEvidenceReviews artifact handles through Arena's download owner. " +
      "Use this after project_proof_reviews when reviews exist; it returns sanitized downloadability " +
      "metadata without raw bytes, storage paths, Workbench folder scans or delivery history inference.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.getProjectVisualEvidenceArtifactCheck(projectId));
    } catch (error) {
      return errorResult(`Failed to check visual evidence artifacts for ${projectId}`, toErrorMessage(error));
    }
  });
}
