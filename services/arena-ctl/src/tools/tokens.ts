import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerTokenTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("refresh_tokens", {
    description: "Trigger token refresh on the control plane and return the resulting token status snapshot.",
    inputSchema: {
      force: z.boolean().optional(),
    },
  }, async ({ force }) => {
    try {
      return jsonResult(await ctx.governance.refreshTokens(force));
    } catch (error) {
      return errorResult("Failed to refresh tokens", toErrorMessage(error));
    }
  });
}
