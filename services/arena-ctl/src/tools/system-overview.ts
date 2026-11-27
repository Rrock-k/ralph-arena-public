import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerSystemOverviewTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("system_overview", {
    description: "Get the current Ralph Arena system overview, including attention items, token state, costs, workers, and projects.",
  }, async () => {
    try {
      return jsonResult(await ctx.governance.getSystemOverview());
    } catch (error) {
      return errorResult("Failed to load system overview", toErrorMessage(error));
    }
  });
}
