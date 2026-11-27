import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerProjectHealthTool(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_health", {
    description: "Get a project snapshot: governance state, worker meta, container inspect, and a short log tail (default 50 lines). Specs are listed by title only. For full logs use container_logs; for spec content use project_specs.",
    inputSchema: {
      projectId: z.string().min(1),
      tail: z.number().int().min(1).max(5000).optional(),
    },
  }, async ({ projectId, tail }) => {
    try {
      return jsonResult(await ctx.governance.getProjectHealth(projectId, tail));
    } catch (error) {
      return errorResult(`Failed to load health for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_specs", {
    description: "Get full spec content for a project (title + body). Use this when you need to read what the project is supposed to build.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.getProjectSpecs(projectId));
    } catch (error) {
      return errorResult(`Failed to load specs for project ${projectId}`, toErrorMessage(error));
    }
  });
}
