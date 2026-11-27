import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerProjectUpdatesTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_updates", {
    description: "Read recent Arena project update outbox and private notification delivery rows for a project. Use this to verify user-facing update contracts such as work.needs_evidence without raw DB access.",
    inputSchema: {
      projectId: z.string().min(1),
      tail: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ projectId, tail }) => {
    try {
      return jsonResult(await ctx.governance.getProjectUpdates(projectId, tail));
    } catch (error) {
      return errorResult(`Failed to load project updates for ${projectId}`, toErrorMessage(error));
    }
  });
}
