import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerProjectProofReviewsTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_proof_reviews", {
    description:
      "Read the current screenshot/visual evidence review projection for a project. " +
      "Use this for proof CTA audits; it returns current read-side proofReviews, visualEvidenceReviews " +
      "and visualEvidenceReadiness diagnostics, not historical outbox delivery rows.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.getProjectProofReviews(projectId));
    } catch (error) {
      return errorResult(`Failed to load proof reviews for ${projectId}`, toErrorMessage(error));
    }
  });
}
