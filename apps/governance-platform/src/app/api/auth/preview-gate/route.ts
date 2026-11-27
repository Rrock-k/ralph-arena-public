import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { randomBytes, createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { peekHandoffCode } from "@/lib/handoff-tokens";
import { resolveProjectAccess } from "@/lib/project-access";
import {
  PROJECT_ACCESS_CAPABILITIES,
  type AccessCapability,
  type EffectiveAccessSource,
  type ProjectAccessCapability,
} from "@/lib/access-control/types";
import { signPreviewAuth, verifyPreviewAuth, buildAnonId } from "@arena/contracts";
import { buildInterstitialHtml, buildErrorHtml } from "./interstitial";

/**
 * GET /api/auth/preview-gate?host=<subdomain>
 *
 * Called by Caddy forward_auth before proxying to a preview container.
 *
 * Visibility levels:
 * - "featured" → anyone, consent cookie required
 * - "public"   → authenticated users, consent cookie required
 * - "private"  → project-scoped authenticated handoff only, consent cookie required
 *
 * Auth cookie (`arena_auth`): HMAC-signed blob set when user authenticates
 * via arena_token. HttpOnly, per-subdomain, 10 min TTL.
 *
 * Consent cookie (`arena_consent`): non-HttpOnly, set by interstitial JS.
 * 24h TTL, per-subdomain.
 *
 * Anon ID: HMAC(userId + projectId) → X-Ralph-Anon-Id header.
 * Containers never see real user identity.
 *
 * Project access headers are derived from Arena project access truth:
 * - X-Arena-Project-Id
 * - X-Arena-Project-Role: public | viewer | member | admin | owner
 * - X-Arena-Project-Capabilities: comma-separated project capabilities
 */

const AUTH_SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
const PREVIEW_AUTH_COOKIE = "arena_auth";
const PREVIEW_EMBED_AUTH_COOKIE = "arena_embed_auth";
const PREVIEW_CONSENT_COOKIE = "arena_consent";
const PREVIEW_EMBED_CONSENT_COOKIE = "arena_embed_consent";
const PREVIEW_AUTH_CHECKED_COOKIE = "arena_auth_checked";
const PREVIEW_AUTH_CHECKED_PARAM = "arena_auth_checked";
const PREVIEW_AUTH_CHECKED_MAX_AGE_SECONDS = 60;

export async function GET(req: NextRequest) {
  const host = req.nextUrl.searchParams.get("host") || req.headers.get("x-forwarded-host") || "";
  const subdomain = host.split(".")[0];

  if (!subdomain) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const isSecure = !host.includes("localhost") && !host.includes("nip.io");
  const forwardedUri = req.headers.get("x-forwarded-uri") || "";

  // Find the live app component by runtime identity; project row mirrors are no longer authoritative.
  const component = await prisma.projectComponent.findFirst({
    where: {
      kind: "app",
      containerName: subdomain,
    },
    select: {
      powerIntent: true,
      runtimeState: true,
      agentState: true,
      previewHealth: true,
      project: {
        select: {
          id: true,
          mode: true,
          visibility: true,
          showAiDisclaimer: true,
          ownerScopeType: true,
          ownerScopeId: true,
        },
      },
    },
  });
  const project = component?.project ?? null;

  // Unknown subdomain — allow through (might be a different service)
  if (!project) {
    return new NextResponse("OK", { status: 200 });
  }

  // If the app runtime is gone or explicitly off, surface preview availability
  // as a runtime problem instead of letting auth gating collapse it into 403.
  let runtimeUnavailable = true;
  if (component) {
    runtimeUnavailable = component.powerIntent === "OFF" || component.runtimeState !== "RUNNING";
    if (
      !runtimeUnavailable &&
      (
        component.previewHealth !== "HEALTHY"
        || component.agentState === "RUNNING"
      )
    ) {
      runtimeUnavailable = !(await isPreviewUpstreamServing(subdomain));
    }
  }
  if (runtimeUnavailable) {
    const html = buildErrorHtml({
      title: "Preview unavailable",
      message: "This preview is currently off, restarting, or still building. Please try again after the app is running.",
    });
    return new NextResponse(html, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" },
    });
  }

  // Parse cookies from the original request (forwarded by Caddy)
  const cookies = parseCookies(req.headers.get("cookie") || "");
  const hasConsent =
    cookies[PREVIEW_CONSENT_COOKIE] === "1"
    || cookies[PREVIEW_EMBED_CONSENT_COOKIE] === "1";
  const isSubresourceRequest = isSubResource(forwardedUri);

  // Iframe embeds (cards, project page) skip interstitial — only direct navigation shows it
  const fetchDest = req.headers.get("sec-fetch-dest") || "";
  const isIframe = fetchDest === "iframe" || hasExplicitEmbedFlag(forwardedUri);

  // --- Try to authenticate via arena_token or arena_auth cookie ---
  const authResult = resolveAuth(req, project.id, cookies);

  // If fresh token auth, redirect to clean URL with Set-Cookie.
  // Caddy forward_auth only passes non-2xx responses to the client,
  // so we use 302 to deliver Set-Cookie headers to the browser.
  if (authResult?.setCookies) {
    const res = redirectToPreview(host, isSecure, cleanForwardedUri(forwardedUri));
    for (const c of authResult.setCookies) {
      res.headers.append("Set-Cookie", c);
    }
    return res;
  }

  if (project.visibility === "featured" && hasPreviewAuthCheckedParam(forwardedUri) && !isSubresourceRequest && !isIframe) {
    const res = redirectToPreview(host, isSecure, cleanForwardedUri(forwardedUri));
    res.headers.append("Set-Cookie", buildPreviewAuthCheckedCookie(isSecure));
    if (hasConsent && !verifyAnonCookie(cookies["arena_anon"], project.id)) {
      res.headers.append("Set-Cookie", buildAnonCookie(randomBytes(8).toString("hex"), project.id, isSecure));
    }
    return res;
  }

  // --- Visibility enforcement ---
  const { visibility } = project;

  if (isSubresourceRequest) {
    if (visibility === "featured") {
      return await allowResponse(authResult, project, cookies, isSecure, host, forwardedUri, {
        anonymousEmbed: true,
      });
    }
    if (authResult) {
      return await allowResponse(authResult, project, cookies, isSecure, host, forwardedUri, {
        anonymousEmbed: false,
      });
    }
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Trusted-team projects can opt out of the AI-generated content disclaimer.
  const showDisclaimer = project.showAiDisclaimer !== false;

  // Interstitial only for direct navigation, not iframes — and only when the
  // AI disclaimer is enabled for this project.
  const needsConsent = showDisclaimer && !hasConsent && !isIframe;

  if (visibility === "featured") {
    if (needsConsent) {
      return interstitialResponse(isSecure);
    }
    if (!authResult && !isIframe && cookies[PREVIEW_AUTH_CHECKED_COOKIE] !== "1") {
      return NextResponse.redirect(
        buildLoginUrl(host, project.id, forwardedUri, { optional: true }),
      );
    }
    return await allowResponse(authResult, project, cookies, isSecure, host, forwardedUri, {
      anonymousEmbed: isIframe,
    });
  }

  if (visibility === "public") {
    // Public means authenticated platform users; only featured supports anonymous embeds.
    if (!authResult) {
      // With the disclaimer disabled, the sign-in interstitial (which carries the
      // AI-generated warning) is skipped — send the visitor straight to login.
      if (!showDisclaimer) {
        return NextResponse.redirect(buildLoginUrl(host, project.id, forwardedUri));
      }
      return interstitialResponse(isSecure, {
        requiresAuth: true,
        loginUrl: buildLoginUrl(host, project.id, forwardedUri),
      });
    }
    if (needsConsent) {
      return interstitialResponse(isSecure);
    }
    return await allowResponse(authResult, project, cookies, isSecure, host, forwardedUri, {
      anonymousEmbed: isIframe,
    });
  }

  // "private" — handoff token/cookie issued by governance after project access check
  if (!authResult) {
    const loginUrl = buildLoginUrl(host, project.id, forwardedUri);
    return errorResponse("Sign in required", "This is a private preview. Open it from governance to continue.", loginUrl);
  }
  if (needsConsent) {
    return interstitialResponse(isSecure);
  }
  return await allowResponse(authResult, project, cookies, isSecure, host, forwardedUri, {
    anonymousEmbed: false,
  });
}

async function isPreviewUpstreamServing(subdomain: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${subdomain}:3000/health`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Auth resolution ────────────────────────────────────────────────

interface AuthInfo {
  userId: string;
  email: string | null;
  /** Set-Cookie headers to include when this is a fresh token auth */
  setCookies?: string[];
}

type PreviewGateProject = {
  id: string;
  mode: string;
  visibility: string | null;
  showAiDisclaimer: boolean;
  ownerScopeType: string | null;
  ownerScopeId: string | null;
};

function resolveAuth(
  req: NextRequest,
  projectId: string,
  cookies: Record<string, string>,
): AuthInfo | null {
  const forwardedUri = req.headers.get("x-forwarded-uri") || "";
  const host = req.nextUrl.searchParams.get("host") || "";
  const isSecure = !host.includes("localhost") && !host.includes("nip.io");

  // 1. Try arena_token from original URI
  const token = extractArenaToken(forwardedUri);
  if (token) {
    const user = peekHandoffCode(token, projectId);
    if (user) {
      // Create auth cookie for subsequent requests
      const authPayload = signPreviewAuth(AUTH_SECRET, user, projectId);
      const securePart = isSecure ? " Secure;" : "";
      const authSameSite = isSecure ? "None" : "Lax";
      const setCookies = [
        `${PREVIEW_AUTH_COOKIE}=${authPayload}; Path=/; Max-Age=600; HttpOnly; SameSite=${authSameSite};${securePart}`,
        `${PREVIEW_CONSENT_COOKIE}=1; Path=/; Max-Age=86400; SameSite=Lax;${securePart}`,
      ];
      if (isSecure) {
        // Embedded previews can run as third-party contexts where normal
        // SameSite cookies are blocked. Keep the same signed payload and
        // consent truth, but store it in CHIPS-compatible cookies.
        setCookies.push(
          `${PREVIEW_EMBED_AUTH_COOKIE}=${authPayload}; Path=/; Max-Age=600; HttpOnly; SameSite=None; Secure; Partitioned`,
          `${PREVIEW_EMBED_CONSENT_COOKIE}=1; Path=/; Max-Age=86400; SameSite=None; Secure; Partitioned`,
        );
      }
      return {
        ...user,
        setCookies,
      };
    }
  }

  // 2. Try arena_auth cookie
  const authCookie = cookies[PREVIEW_AUTH_COOKIE] ?? cookies[PREVIEW_EMBED_AUTH_COOKIE];
  if (authCookie) {
    const payload = verifyPreviewAuth(AUTH_SECRET, authCookie, projectId);
    if (payload) return payload;
  }

  return null;
}

// ─── Response helpers ───────────────────────────────────────────────

type PreviewProjectRole = "public" | "viewer" | "member" | "admin" | "owner";
const PROJECT_CAPABILITY_ORDER = new Map(
  PROJECT_ACCESS_CAPABILITIES.map((capability, index) => [capability, index]),
);

function isProjectAccessCapability(capability: AccessCapability): capability is ProjectAccessCapability {
  return (PROJECT_ACCESS_CAPABILITIES as readonly AccessCapability[]).includes(capability);
}

function roleFromProjectAccess(
  access: Awaited<ReturnType<typeof resolveProjectAccess>>,
  appCapabilities: AccessCapability[],
): PreviewProjectRole {
  if (access.isOwner) return "owner";
  if (appCapabilities.some((capability) => capability !== "project.view")) return "admin";
  if (appCapabilities.includes("project.view")) return "member";
  return "viewer";
}

function isPreviewAppAccessSource(source: EffectiveAccessSource): boolean {
  if (source.kind === "owner") return true;
  return source.kind === "direct" && source.scope.type === "project";
}

function appCapabilitiesFromProjectAccess(
  access: Awaited<ReturnType<typeof resolveProjectAccess>>,
): AccessCapability[] {
  const capabilities = access.sources
    .filter(isPreviewAppAccessSource)
    .flatMap((source) => source.capabilities)
    .filter(isProjectAccessCapability);
  return [...new Set(capabilities)].sort((a, b) =>
    (PROJECT_CAPABILITY_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER)
    - (PROJECT_CAPABILITY_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

async function buildPreviewIdentityHeaders(input: {
  auth: AuthInfo | null;
  project: PreviewGateProject;
  anonId: string;
}): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "X-Ralph-Anon-Id": input.anonId,
    "X-Arena-Project-Id": input.project.id,
  };

  if (!input.auth) {
    headers["X-Arena-Project-Role"] = "public";
    headers["X-Arena-Project-Capabilities"] = "";
    return headers;
  }

  const access = await resolveProjectAccess(
    input.project,
    { user: { id: input.auth.userId, email: input.auth.email } } as Session,
    false,
  );
  const appCapabilities = appCapabilitiesFromProjectAccess(access);
  headers["X-Arena-Project-Role"] = roleFromProjectAccess(access, appCapabilities);
  headers["X-Arena-Project-Capabilities"] = appCapabilities.join(",");
  return headers;
}

async function allowResponse(
  auth: AuthInfo | null,
  project: PreviewGateProject,
  cookies: Record<string, string>,
  isSecure: boolean,
  host?: string,
  forwardedUri?: string,
  opts?: { anonymousEmbed?: boolean },
): Promise<NextResponse> {
  if (auth) {
    return new NextResponse("OK", {
      status: 200,
      headers: await buildPreviewIdentityHeaders({
        auth,
        project,
        anonId: buildAnonId(AUTH_SECRET, auth.userId, project.id),
      }),
    });
  }

  if (opts?.anonymousEmbed) {
    return new NextResponse("OK", {
      status: 200,
      headers: await buildPreviewIdentityHeaders({
        auth: null,
        project,
        anonId: buildAnonId(AUTH_SECRET, `anonymous-embed:${project.id}`, project.id),
      }),
    });
  }

  // Anonymous visitor (featured projects) — cookie-based random ID
  const existingAnonId = verifyAnonCookie(cookies["arena_anon"], project.id);
  if (existingAnonId) {
    return new NextResponse("OK", {
      status: 200,
      headers: await buildPreviewIdentityHeaders({
        auth: null,
        project,
        anonId: existingAnonId,
      }),
    });
  }

  // First anonymous visit — need to set cookie via 302 (Caddy forward_auth
  // only passes Set-Cookie to the client on non-2xx responses)
  const anonId = randomBytes(8).toString("hex");
  const res = redirectToPreview(host || "", isSecure, cleanForwardedUri(forwardedUri || "/"));
  // SameSite=Lax (not Strict): previews are shared as plain links and opened by
  // clicking them from chats/messengers/other sites — a cross-site top-level
  // navigation. Strict suppresses the already-stored anon cookie on exactly that
  // arrival, so the gate re-mints a fresh anonId and the visitor is treated as new
  // every time (duplicate player records, lost "welcome back"). Lax still attaches
  // the cookie on top-level GET navigations while keeping it off cross-site
  // subrequests. This is an opaque pseudonymous id, not an auth credential.
  res.headers.append("Set-Cookie", buildAnonCookie(anonId, project.id, isSecure));
  return res;
}

/** Sign anon cookie: base64url(anonId:projectId).hmac */
function signAnonCookie(anonId: string, projectId: string): string {
  const payload = Buffer.from(`${anonId}:${projectId}`).toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET).update(payload).digest("hex").slice(0, 16);
  return `${payload}.${sig}`;
}

/** Verify and extract anonId from signed cookie, or null if invalid */
function verifyAnonCookie(cookie: string | undefined, projectId: string): string | null {
  if (!cookie) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", AUTH_SECRET).update(payload).digest("hex").slice(0, 16);
  if (sig !== expected) return null;
  const decoded = Buffer.from(payload, "base64url").toString();
  const [anonId, pid] = decoded.split(":");
  if (pid !== projectId || !anonId) return null;
  return anonId;
}

function errorResponse(title: string, message: string, loginUrl?: string): NextResponse {
  const html = buildErrorHtml({ title, message, loginUrl });
  return new NextResponse(html, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" },
  });
}

function interstitialResponse(
  isSecure: boolean,
  opts?: { requiresAuth?: boolean; loginUrl?: string },
): NextResponse {
  const html = buildInterstitialHtml({
    isSecure,
    requiresAuth: opts?.requiresAuth,
    loginUrl: opts?.loginUrl,
  });
  return new NextResponse(html, {
    status: 403,
    headers: { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" },
  });
}

function buildLoginUrl(
  host: string,
  projectId: string,
  forwardedUri?: string,
  opts?: { optional?: boolean },
): string {
  // Redirect to governance preview-redirect which checks session and issues a token.
  // Governance lives at app.{domain} (tunnel) or localhost:3000 (local dev).
  const isLocal = host.includes("localhost") || host.includes("nip.io");
  const scheme = isLocal ? "http" : "https";
  // Extract base domain: preview-xxx.arena.example.test → arena.example.test
  const parts = host.split(".");
  const baseDomain = parts.slice(1).join(".");

  let governanceHost: string;
  if (baseDomain.includes("localhost")) {
    // Local dev: Caddy on same port handles both app and previews
    governanceHost = baseDomain; // e.g. "localhost:8080"
  } else {
    // Production: governance is at app.{baseDomain}
    governanceHost = `app.${baseDomain}`;
  }
  const url = new URL(`${scheme}://${governanceHost}/api/auth/preview-redirect`);
  url.searchParams.set("projectId", projectId);
  const returnPath = cleanForwardedUri(forwardedUri || "/");
  if (returnPath !== "/") {
    url.searchParams.set("returnPath", returnPath);
  }
  if (opts?.optional) {
    url.searchParams.set("optional", "1");
  }
  return url.toString();
}

// ─── Utilities ──────────────────────────────────────────────────────

function extractArenaToken(uri: string): string | null {
  try {
    return new URL(uri || "/", "https://preview.local").searchParams.get("arena_token");
  } catch {
    return null;
  }
}

function hasExplicitEmbedFlag(uri: string): boolean {
  try {
    return new URL(uri || "/", "https://preview.local").searchParams.get("arena_embed") === "1";
  } catch {
    return false;
  }
}

function hasPreviewAuthCheckedParam(uri: string): boolean {
  try {
    return new URL(uri || "/", "https://preview.local").searchParams.get(PREVIEW_AUTH_CHECKED_PARAM) === "1";
  } catch {
    return false;
  }
}

function cleanForwardedUri(uri: string): string {
  try {
    const url = new URL(uri || "/", "https://preview.local");
    if (url.origin !== "https://preview.local") return "/";
    url.searchParams.delete("arena_token");
    url.searchParams.delete(PREVIEW_AUTH_CHECKED_PARAM);
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

function redirectToPreview(host: string, isSecure: boolean, path: string): NextResponse {
  const scheme = isSecure ? "https" : "http";
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: `${scheme}://${host}${path || "/"}`,
      "Referrer-Policy": "no-referrer",
    },
  });
}

function buildPreviewAuthCheckedCookie(isSecure: boolean): string {
  const securePart = isSecure ? " Secure;" : "";
  return `${PREVIEW_AUTH_CHECKED_COOKIE}=1; Path=/; Max-Age=${PREVIEW_AUTH_CHECKED_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax;${securePart}`;
}

function buildAnonCookie(anonId: string, projectId: string, isSecure: boolean): string {
  const securePart = isSecure ? " Secure;" : "";
  return `arena_anon=${signAnonCookie(anonId, projectId)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax;${securePart}`;
}

function isSubResource(uri: string): boolean {
  const path = uri.split("?")[0];
  return /\.(js|mjs|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|webp|avif|json)$/i.test(path);
}

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) result[key.trim()] = rest.join("=").trim();
  }
  return result;
}
