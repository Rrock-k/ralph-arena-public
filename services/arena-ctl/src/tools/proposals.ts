import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerProposalTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("proposal_delete", {
    description: "Archive a proposal through governance so it disappears from active proposal lists.",
    inputSchema: {
      proposalId: z.string().min(1),
    },
  }, async ({ proposalId }) => {
    try {
      return jsonResult(await ctx.governance.deleteProposal(proposalId));
    } catch (error) {
      return errorResult(`Failed to delete proposal ${proposalId}`, toErrorMessage(error));
    }
  });

  server.registerTool("proposal_purge", {
    description: "Permanently delete a proposal through governance, including cascaded dependent records.",
    inputSchema: {
      proposalId: z.string().min(1),
    },
  }, async ({ proposalId }) => {
    try {
      return jsonResult(await ctx.governance.purgeProposal(proposalId));
    } catch (error) {
      return errorResult(`Failed to purge proposal ${proposalId}`, toErrorMessage(error));
    }
  });
}
