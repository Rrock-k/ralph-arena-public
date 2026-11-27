import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sanitizeOperationalLogText } from "@arena/contracts";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerContainerTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("container_logs", {
    description: "Fetch container stdout/stderr logs from the resolved worker-agent for a project.",
    inputSchema: {
      projectId: z.string().min(1),
      tail: z.number().int().min(0).max(5000).optional(),
    },
  }, async ({ projectId, tail }) => {
    try {
      const info = await ctx.governance.getProjectWorkerInfo(projectId);
      const workerUrl = info?.workerUrl;
      const containerName = info?.containerName;

      if (!workerUrl) {
        return errorResult(`Project ${projectId} does not currently resolve to a worker URL`);
      }
      if (!containerName) {
        return errorResult(`Project ${projectId} does not have a container name`);
      }

      const logs = await ctx.worker.getContainerLogs(workerUrl, containerName, tail ?? 500);
      const sanitizedLogs = typeof logs === "object" && logs && typeof (logs as { logs?: unknown }).logs === "string"
        ? { ...(logs as Record<string, unknown>), logs: sanitizeOperationalLogText((logs as { logs: string }).logs) }
        : logs;
      return jsonResult({
        projectId,
        workerUrl,
        containerName,
        ...(typeof sanitizedLogs === "object" && sanitizedLogs ? sanitizedLogs as Record<string, unknown> : { logs: sanitizedLogs }),
      });
    } catch (error) {
      return errorResult(`Failed to load container logs for project ${projectId}`, toErrorMessage(error));
    }
  });
}
