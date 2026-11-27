import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { decryptSecret, getEncryptionKey } from "@/lib/crypto";
import {
  buildRunnerInitProjection,
  injectGithubTokenInRepoUrl,
  RUNNER_INIT_PROJECT_INCLUDE,
} from "@/lib/runner-init-readiness";


interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/internal/projects/:id/init
 *
 * RA-098: Runner fetches this once at startup.
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const project = await (prisma as any).project.findUnique({
    where: { id },
    include: RUNNER_INIT_PROJECT_INCLUDE,
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const secrets: Record<string, string> = {};
  try {
    const key = getEncryptionKey();
    for (const s of project.secrets) {
      const value = decryptSecret({ ciphertext: s.encryptedValue, iv: s.iv, authTag: s.authTag }, key);
      if (value) secrets[s.key] = value;
    }
  } catch (e) {
    console.error("Failed to decrypt secrets:", e);
  }

  const initProjection = await buildRunnerInitProjection(project);

  return NextResponse.json({
    repo: initProjection.repo
      ? {
          ...initProjection.repo,
          url: injectGithubTokenInRepoUrl(initProjection.repo.url),
        }
      : null,
    specs: initProjection.specs,
    specsHash: initProjection.specsHash,
    assets: initProjection.assets,
    assetsHash: initProjection.assetsHash,
    secrets,
    proposal: initProjection.proposal,
    project: initProjection.project,
    capabilities: initProjection.capabilities,
    commandTemplate: initProjection.commandTemplate,
    loopSource: initProjection.loopSource,
    ralphConfig: initProjection.ralphConfig,
    platformPrompt: initProjection.platformPrompt,
  });
}
