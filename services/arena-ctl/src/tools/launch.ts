import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerLaunchTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("create_personal_project", {
    description: "Create and queue a new personal project through governance.",
    inputSchema: {
      spec: z.string().min(1),
      title: z.string().optional(),
      agent: z.string().optional(),
      agentImpl: z.string().optional(),
      model: z.string().optional(),
      budget: z.number().positive().optional(),
      claudeAuthMode: z.string().optional(),
      codexAuthMode: z.string().optional(),
      runnerBackend: z.string().optional(),
      toolId: z.string().optional(),
      proposalId: z.string().optional(),
      repoUrl: z.string().optional(),
      repoBranch: z.string().optional(),
      vpsServerType: z.string().optional(),
      envOverrides: z.record(z.string(), z.union([z.string(), z.null()])).optional(),
    },
  }, async ({ budget, title, ...rest }) => {
    try {
      return jsonResult(await ctx.governance.createPersonalProject({
        ...rest,
        title,
        initialBudgetUsd: budget,
      }));
    } catch (error) {
      return errorResult("Failed to create personal project", toErrorMessage(error));
    }
  });

  server.registerTool("launch_proposal", {
    description: "Launch a proposal-backed community project through governance.",
    inputSchema: {
      proposalId: z.string().min(1),
      agent: z.string().min(1),
      agentImpl: z.string().min(1),
      model: z.string().optional(),
      initialBudgetUsd: z.number().positive().optional(),
      claudeAuthMode: z.string().optional(),
      codexAuthMode: z.string().optional(),
      runnerBackend: z.string().optional(),
      toolId: z.string().optional(),
      repoUrl: z.string().optional(),
      repoBranch: z.string().optional(),
      vpsServerType: z.string().optional(),
      envOverrides: z.record(z.string(), z.string()).optional(),
    },
  }, async (args) => {
    try {
      return jsonResult(await ctx.governance.launchProposal(args));
    } catch (error) {
      return errorResult(`Failed to launch proposal ${args.proposalId}`, toErrorMessage(error));
    }
  });
}
