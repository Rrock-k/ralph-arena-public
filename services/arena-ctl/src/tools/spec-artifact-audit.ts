import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerSpecArtifactAuditTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("fleet_spec_artifact_audit", {
    description:
      "Summarize the fleet's accepted spec artifact state for RA-287 operator repair. " +
      "Reports current v1 artifacts and repair-required markdown-only, malformed, unsafe, or no-spec projects.",
    inputSchema: {
      includeArchived: z.boolean().optional().describe("Include archived projects in scanning and counts (default: true)"),
      limitProjects: z.number().int().min(1).max(100).optional().describe("Maximum repair-required projects returned (default: 25)"),
    },
  }, async ({ includeArchived, limitProjects }) => {
    try {
      return jsonResult(await ctx.governance.getFleetSpecArtifactAudit({
        includeArchived: includeArchived ?? true,
        limitProjects,
      }));
    } catch (error) {
      return errorResult("Failed to audit fleet spec artifact state", toErrorMessage(error));
    }
  });

  server.registerTool("project_spec_artifact_audit", {
    description:
      "Classify one project's accepted spec artifact state for RA-287 operator work. " +
      "Reports current v1 artifact, markdown-only spec, malformed metadata, unsafe metadata, or no spec.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.getProjectSpecArtifactAudit(projectId));
    } catch (error) {
      return errorResult(`Failed to audit spec artifact state for ${projectId}`, toErrorMessage(error));
    }
  });
}
