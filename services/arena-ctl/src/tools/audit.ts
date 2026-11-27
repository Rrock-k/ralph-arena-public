import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerAuditTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_audit", {
    description:
      "Run invariant checks against all active projects. " +
      "Catches: missing agentLoopVersionId/toolId, orphan projects without components, " +
      "state-machine violations, missing workspace directories. " +
      "Use after code/schema changes to verify data integrity. " +
      "With includeMigrationChecks=true: also checks repo existence, branch naming, workspace code, sourceConfig format (RA-247).",
    inputSchema: {
      projectId: z.string().optional().describe("Optional: audit a single project by ID"),
      includeArchived: z.boolean().optional().describe("Include archived projects (default: false)"),
      skipFilesystem: z.boolean().optional().describe("Skip workspace directory checks (default: false)"),
      includeMigrationChecks: z.boolean().optional().describe("RA-247: Include migration readiness checks — repo, branch, workspace code, sourceConfig (slower, hits GitHub API)"),
    },
  }, async (args) => {
    try {
      const projectIds = args.projectId ? [args.projectId] : undefined;
      const report = await ctx.governance.getAudit({
        projectIds,
        includeArchived: args.includeArchived,
        skipFilesystem: args.skipFilesystem,
        includeMigrationChecks: args.includeMigrationChecks,
      }) as {
        generatedAt: string;
        totalProjects: number;
        passCount: number;
        failCount: number;
        projects: Array<{
          projectId: string;
          projectName: string;
          state: string;
          pass: boolean;
          violations: Array<{ rule: string; severity: string; message: string }>;
        }>;
        summary: Array<{ rule: string; count: number }>;
      };

      // Format a readable report
      const lines: string[] = [];
      lines.push(`# Project Audit — ${report.generatedAt}`);
      lines.push(`**${report.totalProjects}** projects checked: **${report.passCount}** pass, **${report.failCount}** fail\n`);

      if (report.failCount === 0) {
        lines.push("All projects pass invariant checks.");
      } else {
        lines.push("## Violations\n");
        for (const p of report.projects) {
          if (p.pass) continue;
          lines.push(`### ${p.projectName} (\`${p.projectId}\`) — ${p.state}`);
          for (const v of p.violations) {
            const icon = v.severity === "error" ? "x" : "!";
            lines.push(`- [${icon}] **${v.rule}**: ${v.message}`);
          }
          lines.push("");
        }

        if (report.summary.length > 0) {
          lines.push("## Summary by rule\n");
          for (const s of report.summary) {
            lines.push(`- **${s.rule}**: ${s.count} project(s)`);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (error) {
      return errorResult("Failed to run project audit", toErrorMessage(error));
    }
  });
}
