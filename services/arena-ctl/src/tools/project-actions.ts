import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerProjectActionTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("project_relaunch", {
    description: "Relaunch a project through governance, optionally overriding loop/tool/runtime parameters.",
    inputSchema: {
      projectId: z.string().min(1),
      agent: z.string().optional(),
      agentImpl: z.string().optional(),
      model: z.string().optional(),
      claudeAuthMode: z.string().optional(),
      codexAuthMode: z.string().optional(),
      runnerBackend: z.string().optional(),
      toolId: z.string().optional(),
      envOverrides: z.record(z.string(), z.string()).optional(),
    },
  }, async ({ projectId, ...rest }) => {
    try {
      return jsonResult(await ctx.governance.relaunchProject(projectId, rest));
    } catch (error) {
      return errorResult(`Failed to relaunch project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_retry_now", {
    description: "Clear a retryable blocker, or a resolved MANUAL wait, for a project now. Use only when the operator has evidence that the wait condition can be retried.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.retryProjectNow(projectId));
    } catch (error) {
      return errorResult(`Failed to retry project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_tg_spec_launch_start", {
    description: "Explicitly start a configured tg-spec project after its first accepted spec import. This is not relaunch and not plain Agent ON.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.startTgSpecLaunch(projectId));
    } catch (error) {
      return errorResult(`Failed to start tg-spec launch for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_archive", {
    description: "Archive a project. Sets archivedAt and forces app power OFF without auto-unarchiving later.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.archiveProject(projectId));
    } catch (error) {
      return errorResult(`Failed to archive project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_unarchive", {
    description: "Unarchive a project. Does not automatically turn the app or agent on.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.unarchiveProject(projectId));
    } catch (error) {
      return errorResult(`Failed to unarchive project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_agent_on", {
    description: "Set agent intent ON for a project. App power must already be ON.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.setAgentIntent(projectId, "ON"));
    } catch (error) {
      return errorResult(`Failed to set agent ON for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_agent_off", {
    description: "Set agent intent OFF for a project. Preview stays available while app power remains ON.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.setAgentIntent(projectId, "OFF"));
    } catch (error) {
      return errorResult(`Failed to set agent OFF for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_power_on", {
    description: "Set app power ON for a project.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.setPowerIntent(projectId, "ON"));
    } catch (error) {
      return errorResult(`Failed to set app power ON for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_power_off", {
    description: "Set app power OFF for a project.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.setPowerIntent(projectId, "OFF"));
    } catch (error) {
      return errorResult(`Failed to set app power OFF for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_refresh_preview", {
    description: "Request a soft preview sidecar refresh for a project with a live running runtime.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.refreshProjectPreview(projectId));
    } catch (error) {
      return errorResult(`Failed to refresh preview for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("worker_restart_service", {
    description: "Restart a live worker-agent service in a safe worker maintenance window. This is worker-scoped and must not be used as project runtime recovery.",
    inputSchema: {
      workerHost: z.string().min(1),
      vpsIp: z.string().optional(),
    },
  }, async ({ workerHost, vpsIp }) => {
    try {
      return jsonResult(await ctx.governance.restartWorkerService(workerHost, { vpsIp }));
    } catch (error) {
      return errorResult(`Failed to restart worker service ${workerHost}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_recreate_runtime", {
    description: "Recreate a project runtime on current platform software while preserving project truth. Use for maintenance, not for new runs.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.recreateProjectRuntime(projectId));
    } catch (error) {
      return errorResult(`Failed to recreate runtime for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_delete", {
    description: "Delete a project and optionally remove docker/workspace state.",
    inputSchema: {
      projectId: z.string().min(1),
      removeDocker: z.boolean().optional(),
      removeWorkspace: z.boolean().optional(),
    },
  }, async ({ projectId, removeDocker, removeWorkspace }) => {
    try {
      return jsonResult(await ctx.governance.deleteProject(projectId, { removeDocker, removeWorkspace }));
    } catch (error) {
      return errorResult(`Failed to delete project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_add_spec", {
    description: "Append a new spec entry to a project.",
    inputSchema: {
      projectId: z.string().min(1),
      title: z.string().optional(),
      content: z.string().min(1),
    },
  }, async ({ projectId, title, content }) => {
    try {
      return jsonResult(await ctx.governance.addSpec(projectId, { title, content }));
    } catch (error) {
      return errorResult(`Failed to add spec to project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_set_budget", {
    description: "Set the absolute project budget limit.",
    inputSchema: {
      projectId: z.string().min(1),
      totalCreditsUsd: z.number().positive(),
      isEnabled: z.boolean().optional(),
      note: z.string().optional(),
    },
  }, async ({ projectId, totalCreditsUsd, isEnabled, note }) => {
    try {
      return jsonResult(await ctx.governance.setBudget(projectId, { totalCreditsUsd, isEnabled, note }));
    } catch (error) {
      return errorResult(`Failed to set budget for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_provide_secret", {
    description: "Store or provide a project secret in governance.",
    inputSchema: {
      projectId: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      description: z.string().optional(),
    },
  }, async ({ projectId, key, value, description }) => {
    try {
      return jsonResult(await ctx.governance.provideSecret(projectId, { key, value, description }));
    } catch (error) {
      return errorResult(`Failed to provide secret for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_required_secret_add", {
    description: "Add a required secret requirement to a project.",
    inputSchema: {
      projectId: z.string().min(1),
      key: z.string().min(1),
      description: z.string().optional(),
    },
  }, async ({ projectId, key, description }) => {
    try {
      return jsonResult(await ctx.governance.addRequiredSecret(projectId, { key, description }));
    } catch (error) {
      return errorResult(`Failed to add required secret for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_required_secret_remove", {
    description: "Remove a required secret requirement from a project.",
    inputSchema: {
      projectId: z.string().min(1),
      key: z.string().min(1),
    },
  }, async ({ projectId, key }) => {
    try {
      return jsonResult(await ctx.governance.removeRequiredSecret(projectId, { key }));
    } catch (error) {
      return errorResult(`Failed to remove required secret for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_normalize_source_config_recipe", {
    description: "Remove the legacy sourceConfig.recipe key from the primary component of a project. Narrow mechanical repair only; no batch migration.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.normalizeSourceConfigRecipe(projectId));
    } catch (error) {
      return errorResult(`Failed to normalize sourceConfig.recipe for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_set_visibility", {
    description: "Set project visibility explicitly, including featured visibility for Explore/home surfacing.",
    inputSchema: {
      projectId: z.string().min(1),
      visibility: z.enum(["private", "public", "featured"]),
    },
  }, async ({ projectId, visibility }) => {
    try {
      return jsonResult(await ctx.governance.setProjectVisibility(projectId, visibility));
    } catch (error) {
      return errorResult(`Failed to set visibility for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_set_model", {
    description: "Set the model for future project runtime claims. Does not relaunch, recreate runtime, clear blockers, or wake loop work.",
    inputSchema: {
      projectId: z.string().min(1),
      model: z.string().min(1),
    },
  }, async ({ projectId, model }) => {
    try {
      return jsonResult(await ctx.governance.setProjectModel(projectId, model));
    } catch (error) {
      return errorResult(`Failed to set model for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_set_runtime_system", {
    description: "Set the runtime system/tool family and model for future project runtime claims. Does not relaunch, recreate runtime, clear blockers, retry, change App/Agent intent, or wake loop work.",
    inputSchema: {
      projectId: z.string().min(1),
      agent: z.string().min(1),
      agentImpl: z.string().min(1),
      model: z.string().min(1).optional(),
      toolId: z.string().min(1).optional(),
      providerBillingMode: z.enum(["byok", "platform_credits", "platform_credentials"]),
      claudeAuthMode: z.enum(["oauth", "api_key"]).nullable().optional(),
      codexAuthMode: z.enum(["subscription", "api_key"]).nullable().optional(),
    },
  }, async ({ projectId, ...body }) => {
    try {
      return jsonResult(await ctx.governance.setProjectRuntimeSystem(projectId, body));
    } catch (error) {
      return errorResult(`Failed to set runtime system for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_set_source_snapshot", {
    description: "Set the project source snapshot commit SHA for future runtime claims. Does not relaunch, recreate runtime, clear blockers, or wake loop work.",
    inputSchema: {
      projectId: z.string().min(1),
      commitSha: z.string().regex(/^[0-9a-f]{40}$/i),
    },
  }, async ({ projectId, commitSha }) => {
    try {
      return jsonResult(await ctx.governance.setProjectSourceSnapshot(projectId, commitSha));
    } catch (error) {
      return errorResult(`Failed to set source snapshot for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_set_runtime_auth_modes", {
    description: "Set runtime auth modes for future project runtime claims. Does not relaunch, recreate runtime, clear blockers, retry, or wake loop work.",
    inputSchema: {
      projectId: z.string().min(1),
      claudeAuthMode: z.enum(["oauth", "api_key"]).nullable().optional(),
      codexAuthMode: z.enum(["subscription", "api_key"]).nullable().optional(),
    },
  }, async ({ projectId, claudeAuthMode, codexAuthMode }) => {
    try {
      return jsonResult(await ctx.governance.setProjectRuntimeAuthModes(projectId, {
        ...(claudeAuthMode !== undefined ? { claudeAuthMode } : {}),
        ...(codexAuthMode !== undefined ? { codexAuthMode } : {}),
      }));
    } catch (error) {
      return errorResult(`Failed to set runtime auth modes for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_set_visual_evidence_mode", {
    description: "Set visual evidence mode for future project runtime claims. Does not relaunch, recreate runtime, clear blockers, retry, or wake loop work.",
    inputSchema: {
      projectId: z.string().min(1),
      visualEvidenceMode: z.enum(["off", "required", "new_tasks_only"]),
    },
  }, async ({ projectId, visualEvidenceMode }) => {
    try {
      return jsonResult(await ctx.governance.setProjectVisualEvidenceMode(projectId, visualEvidenceMode));
    } catch (error) {
      return errorResult(`Failed to set visual evidence mode for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_list_assets", {
    description: "List uploaded project assets.",
    inputSchema: {
      projectId: z.string().min(1),
    },
  }, async ({ projectId }) => {
    try {
      return jsonResult(await ctx.governance.listAssets(projectId));
    } catch (error) {
      return errorResult(`Failed to list assets for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_upload_asset", {
    description: "Upload a local file as a project asset that specs can reference via assets/... paths.",
    inputSchema: {
      projectId: z.string().min(1),
      filePath: z.string().min(1),
      path: z.string().optional(),
      contentType: z.string().optional(),
    },
  }, async ({ projectId, filePath, path: assetPath, contentType }) => {
    try {
      const resolvedPath = path.resolve(filePath);
      const fileStat = await stat(resolvedPath);
      if (!fileStat.isFile()) {
        return errorResult(`Failed to upload asset to project ${projectId}`, `${resolvedPath} is not a file`);
      }
      const bytes = await readFile(resolvedPath);
      return jsonResult(await ctx.governance.uploadAsset(projectId, {
        filename: path.basename(resolvedPath),
        contentBase64: bytes.toString("base64"),
        path: assetPath,
        contentType,
      }));
    } catch (error) {
      return errorResult(`Failed to upload asset to project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("project_delete_asset", {
    description: "Soft-delete an uploaded project asset.",
    inputSchema: {
      projectId: z.string().min(1),
      assetId: z.string().min(1),
    },
  }, async ({ projectId, assetId }) => {
    try {
      return jsonResult(await ctx.governance.deleteAsset(projectId, assetId));
    } catch (error) {
      return errorResult(`Failed to delete asset ${assetId} from project ${projectId}`, toErrorMessage(error));
    }
  });
}
