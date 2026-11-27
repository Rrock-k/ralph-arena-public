import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { jsonResult, errorResult, toErrorMessage } from "../result.js";
import type { ArenaCtlContext } from "../tool-context.js";

export function registerWorkspaceTools(server: McpServer, ctx: ArenaCtlContext) {
  server.registerTool("workspace_read", {
    description: "Read a file from a local project workspace. VPS projects are rejected explicitly.",
    inputSchema: {
      projectId: z.string().min(1),
      filePath: z.string().min(1),
    },
  }, async ({ projectId, filePath }) => {
    try {
      const resolved = await resolveWorkspaceTarget(ctx, projectId, filePath);
      if (!resolved.ok) return errorResult(resolved.error);

      const content = await readFile(resolved.absolutePath, "utf8");
      return jsonResult({
        projectId,
        workspacePath: resolved.workspacePath,
        filePath: resolved.relativePath,
        content,
      });
    } catch (error) {
      return errorResult(`Failed to read workspace file for project ${projectId}`, toErrorMessage(error));
    }
  });

  server.registerTool("workspace_write", {
    description: "Write a file into a local project workspace. Creates parent directories as needed. VPS projects are rejected explicitly.",
    inputSchema: {
      projectId: z.string().min(1),
      filePath: z.string().min(1),
      content: z.string(),
    },
  }, async ({ projectId, filePath, content }) => {
    try {
      const resolved = await resolveWorkspaceTarget(ctx, projectId, filePath);
      if (!resolved.ok) return errorResult(resolved.error);

      await mkdir(path.dirname(resolved.absolutePath), { recursive: true });
      await writeFile(resolved.absolutePath, content, "utf8");
      return jsonResult({
        success: true,
        projectId,
        workspacePath: resolved.workspacePath,
        filePath: resolved.relativePath,
        bytesWritten: Buffer.byteLength(content, "utf8"),
      });
    } catch (error) {
      return errorResult(`Failed to write workspace file for project ${projectId}`, toErrorMessage(error));
    }
  });
}

async function resolveWorkspaceTarget(ctx: ArenaCtlContext, projectId: string, filePath: string) {
  const health = await ctx.governance.getProjectHealth(projectId);
  const project = readProjectFromHealth(health);
  if (!project) {
    return { ok: false as const, error: "Project health response did not include project metadata" };
  }

  if (project.runnerBackend === "vps") {
    return {
      ok: false as const,
      error: "Workspace access is not available for VPS projects. Use container_logs or add a remote workspace API in a later phase.",
    };
  }

  const basePath = resolveProjectWorkspacePath(ctx, project);
  const workspaceRoot = path.resolve(ctx.config.workspaceRoot);
  if (!isPathInside(basePath, workspaceRoot)) {
    return { ok: false as const, error: `Workspace path ${basePath} is outside configured root ${workspaceRoot}` };
  }

  const relativePath = filePath.trim();
  if (!relativePath) {
    return { ok: false as const, error: "filePath is required" };
  }
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
    return { ok: false as const, error: "Path traversal is not allowed" };
  }

  const absolutePath = path.resolve(basePath, relativePath);
  if (!isPathInside(absolutePath, basePath)) {
    return { ok: false as const, error: "Resolved path escaped the workspace root" };
  }

  return {
    ok: true as const,
    workspacePath: basePath,
    absolutePath,
    relativePath,
  };
}

export function isPathInside(candidate: string, base: string) {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

export function readProjectFromHealth(health: unknown): Record<string, unknown> | null {
  if (!health || typeof health !== "object" || !("project" in health)) return null;
  const project = (health as { project?: unknown }).project;
  return project && typeof project === "object" ? project as Record<string, unknown> : null;
}

export function resolveProjectWorkspacePath(
  ctx: { config: Pick<ArenaCtlContext["config"], "workspaceRoot"> },
  project: Record<string, unknown>,
) {
  const slug = typeof project.slug === "string" ? project.slug.trim() : "";
  const id = typeof project.id === "string" ? project.id : "";
  const name = typeof project.name === "string" ? project.name.trim() : "";
  const workspaceLabel = slug || buildWorkspaceLabel(name || "project", id);
  return path.resolve(ctx.config.workspaceRoot, workspaceLabel);
}

function buildWorkspaceLabel(name: string, projectId: string) {
  const titleSlug = slugify(name) || "project";
  const idSuffix = projectId.slice(-6).toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${titleSlug}-${idSuffix || "local"}`;
}

function slugify(title: string) {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
