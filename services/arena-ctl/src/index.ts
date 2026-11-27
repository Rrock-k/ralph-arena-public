import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { GovernanceClient } from "./governance-client.js";
import { WorkerClient } from "./worker-client.js";
import { registerSystemOverviewTool } from "./tools/system-overview.js";
import { registerProjectHealthTool } from "./tools/project-health.js";
import { registerProjectActionTools } from "./tools/project-actions.js";
import { registerTokenTools } from "./tools/tokens.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerContainerTools } from "./tools/container-ops.js";
import { registerLaunchTools } from "./tools/launch.js";
import { registerProposalTools } from "./tools/proposals.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerRecoveryTools } from "./tools/recovery.js";
import { registerFleetSummaryTool } from "./tools/fleet-summary.js";
import { registerProjectExplainTool } from "./tools/project-explain.js";
import { registerProjectUpdatesTool } from "./tools/project-updates.js";
import { registerProjectProofReviewsTool } from "./tools/project-proof-reviews.js";
import { registerProjectVisualEvidenceArtifactCheckTool } from "./tools/project-visual-evidence-artifact-check.js";
import { registerSpecArtifactAuditTool } from "./tools/spec-artifact-audit.js";
import { registerProjectExperimentPreflightTool } from "./tools/project-experiment-preflight.js";
import { registerProjectStageSnapshotTool } from "./tools/project-stage-snapshot.js";
import { registerProjectStageCandidatesTool } from "./tools/project-stage-candidates.js";

async function main() {
  const config = loadConfig();
  const ctx = {
    config,
    governance: new GovernanceClient(config),
    worker: new WorkerClient(config),
  };

  const server = new McpServer({
    name: "arena-ctl",
    version: "0.1.0",
  }, {
    capabilities: {
      logging: {},
    },
  });

  registerSystemOverviewTool(server, ctx);
  registerProjectHealthTool(server, ctx);
  registerProjectActionTools(server, ctx);
  registerTokenTools(server, ctx);
  registerWorkspaceTools(server, ctx);
  registerContainerTools(server, ctx);
  registerLaunchTools(server, ctx);
  registerProposalTools(server, ctx);
  registerAuditTools(server, ctx);
  registerFleetSummaryTool(server, ctx);
  registerProjectExplainTool(server, ctx);
  registerProjectUpdatesTool(server, ctx);
  registerProjectProofReviewsTool(server, ctx);
  registerProjectVisualEvidenceArtifactCheckTool(server, ctx);
  registerSpecArtifactAuditTool(server, ctx);
  registerProjectExperimentPreflightTool(server, ctx);
  registerProjectStageSnapshotTool(server, ctx);
  registerProjectStageCandidatesTool(server, ctx);
  registerRecoveryTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[arena-ctl] MCP server connected over stdio");
}

main().catch((error) => {
  console.error("[arena-ctl] fatal:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
