import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createHandoffCode } from "@/lib/handoff-tokens";
import { getAppComponent } from "@/lib/operator-display";
import { resolveProjectAccess } from "@/lib/project-access";
import { buildErrorHtml } from "@/app/api/auth/preview-gate/interstitial";
import { getPreferredPreviewUrl } from "@/lib/preview-url";

/**
 * GET /api/auth/preview-redirect?projectId=xxx&returnPath=/path
 *
 * Authenticates the user via governance session, creates a handoff code,
 * and redirects to the preview URL with the token embedded on the same path.
 * Used by "Open Preview" buttons. Featured previews remain guest-visible, but
 * preserve the signed-in user identity when a governance session exists.
 */

const ARENA_TOKEN_PARAM = "arena_token";
const PREVIEW_AUTH_CHECKED_PARAM = "arena_auth_checked";
const MAX_RETURN_PATH_LENGTH = 2048;

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    const html = buildErrorHtml({
      title: "Invalid link",
      message:
        "This preview link is incomplete. Please use the link from the project page.",
    });
    return new NextResponse(html, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const returnPath = normalizePreviewReturnPath(req.nextUrl.searchParams.get("returnPath"));
  const optionalAuthCheck = req.nextUrl.searchParams.get("optional") === "1";

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      mode: true,
      visibility: true,
      ownerScopeId: true,
      ownerScopeType: true,
      proposalId: true,
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          kind: true,
          previewUrl: true,
          containerName: true,
        },
      },
      vpsHost: { select: { previewDomain: true } },
    },
  });
  const appComponent = project ? getAppComponent(project) : null;

  const previewUrl = project
    ? getPreferredPreviewUrl({
        previewUrl: appComponent?.previewUrl ?? null,
        containerName: appComponent?.containerName ?? null,
        previewDomain:
          project.vpsHost?.previewDomain ??
          process.env.PREVIEW_DOMAIN?.trim() ??
          null,
      })
    : null;

  if (!project || !previewUrl) {
    const html = buildErrorHtml({
      title: "Preview not available",
      message:
        "This project doesn't exist or doesn't have a preview running yet.",
    });
    return new NextResponse(html, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const session = await auth();
  if (project.visibility === "featured" && !session?.user) {
    const previewTarget = buildPreviewTarget(previewUrl, returnPath);
    previewTarget.searchParams.set(PREVIEW_AUTH_CHECKED_PARAM, "1");
    return NextResponse.redirect(previewTarget.toString());
  }

  // Public/private — require session
  if (!session?.user) {
    // Redirect to sign-in, then back here
    // Use AUTH_URL to avoid 0.0.0.0 in dev mode
    const publicBase =
      process.env.AUTH_URL || process.env.NEXTAUTH_URL || req.nextUrl.origin;
    const returnUrl = new URL("/api/auth/preview-redirect", publicBase);
    returnUrl.searchParams.set("projectId", projectId);
    if (returnPath !== "/") {
      returnUrl.searchParams.set("returnPath", returnPath);
    }
    if (optionalAuthCheck) {
      returnUrl.searchParams.set("optional", "1");
    }
    const signInUrl = new URL("/api/auth/signin", publicBase);
    signInUrl.searchParams.set("callbackUrl", returnUrl.toString());
    return NextResponse.redirect(signInUrl.toString());
  }

  // Private — check ownership/admin
  if (project.visibility === "private") {
    const access = await resolveProjectAccess(project, session);
    if (!access.canAccessPrivate) {
      const html = buildErrorHtml({
        title: "Access denied",
        message: "This private preview is only visible to the project owner.",
      });
      return new NextResponse(html, {
        status: 403,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  }

  // Create handoff code and redirect to preview with token
  const code = createHandoffCode(projectId, {
    id: session.user.id,
    email: session.user.email ?? null,
  });

  const previewTarget = buildPreviewTarget(previewUrl, returnPath);
  previewTarget.searchParams.set(ARENA_TOKEN_PARAM, code);
  return NextResponse.redirect(previewTarget.toString());
}

function normalizePreviewReturnPath(raw: string | null): string {
  if (!raw || raw.length > MAX_RETURN_PATH_LENGTH) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const pathUrl = new URL(raw, "https://preview.local");
    if (pathUrl.origin !== "https://preview.local") return "/";
    pathUrl.searchParams.delete(ARENA_TOKEN_PARAM);
    pathUrl.searchParams.delete(PREVIEW_AUTH_CHECKED_PARAM);
    return `${pathUrl.pathname}${pathUrl.search}${pathUrl.hash}` || "/";
  } catch {
    return "/";
  }
}

function buildPreviewTarget(previewUrl: string, returnPath: string): URL {
  const previewTarget = new URL(previewUrl);
  const pathUrl = new URL(returnPath, previewTarget.origin);
  previewTarget.pathname = pathUrl.pathname;
  previewTarget.search = pathUrl.search;
  previewTarget.hash = pathUrl.hash;
  return previewTarget;
}
