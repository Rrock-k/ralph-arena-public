import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerRecoveryTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_recovery_attempt", {
    description: "Run an explicit recovery action for a project. Use project_health first for diagnosis. Supported actions are preview_restore and recreate_runtime.",
    inputSchema: {
      projectId: z.string().min(1),
      action: z.enum([
        "preview_restore",
        "recreate_runtime",
      ]),
    },
  }, async ({ projectId, ...rest }) => {
    try {
      return jsonResult(await ctx.governance.attemptProjectRecovery(projectId, rest));
    } catch (error) {
      return errorResult(`Failed to run recovery attempt for project ${projectId}`, toErrorMessage(error));
    }
  });
}
