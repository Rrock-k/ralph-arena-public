import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  projectComponentFindFirst: vi.fn(),
  peekHandoffCode: vi.fn(),
  resolveProjectAccess: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    projectComponent: {
      findFirst: mocks.projectComponentFindFirst,
    },
  },
}));

vi.mock("@/lib/handoff-tokens", () => ({
  peekHandoffCode: mocks.peekHandoffCode,
}));

vi.mock("@/lib/project-access", () => ({
  resolveProjectAccess: mocks.resolveProjectAccess,
}));

import { prisma } from "@/lib/prisma";
import { peekHandoffCode } from "@/lib/handoff-tokens";
import { GET } from "./route";

describe("preview-gate route", () => {
  function mockPreviewComponent(overrides?: Record<string, unknown>) {
    return {
      powerIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      previewHealth: "HEALTHY",
      project: {
        id: "project-1",
        mode: "community",
        visibility: "public",
        ownerScopeType: "user",
        ownerScopeId: null,
      },
      ...overrides,
    } as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectAccess.mockResolvedValue({
      isOwner: false,
      canManage: false,
      sources: [],
      effectiveCapabilities: [],
      hasCapability: () => false,
    });
  });

  it("returns 400 when host is missing", async () => {
    const request = new NextRequest("http://localhost/api/auth/preview-gate");
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  it("allows unknown subdomains through", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-unknown.example.com");
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it("shows interstitial for public preview without consent cookie", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent(),
    );
    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-public.localhost", {
      headers: { "x-forwarded-uri": "/aa325?tab=clips" },
    });
    const response = await GET(request);
    // Public without auth → interstitial with login link
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("Sign in");
    expect(html).toContain("returnPath=%2Faa325%3Ftab%3Dclips");
  });

  it("returns runtime unavailable instead of auth-gated 403 when the app is off", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({ powerIntent: "OFF", runtimeState: "ABSENT" }),
    );

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-off.localhost");
    const response = await GET(request);

    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain("Preview unavailable");
    expect(html).not.toContain("Sign in");
  });

  it("returns runtime unavailable when the row is running but the preview app is not actually serving yet", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        agentState: "RUNNING",
        previewHealth: "HEALTHY",
      }),
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect refused"));

    try {
      const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-building.localhost");
      const response = await GET(request);

      expect(response.status).toBe(503);
      const html = await response.text();
      expect(html).toContain("Preview unavailable");
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://preview-building:3000/health",
        expect.objectContaining({ method: "GET", redirect: "manual" }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("redirects direct featured visits through an optional governance identity check", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-1",
          visibility: "featured",
          ownerScopeId: null,
        },
      }),
    );

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost", {
      headers: {
        cookie: "arena_consent=1",
        "x-forwarded-uri": "/aa325?tab=clips&arena_token=stale",
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const redirectUrl = new URL(location!);
    expect(redirectUrl.origin).toBe("http://localhost");
    expect(redirectUrl.pathname).toBe("/api/auth/preview-redirect");
    expect(redirectUrl.searchParams.get("projectId")).toBe("project-1");
    expect(redirectUrl.searchParams.get("returnPath")).toBe("/aa325?tab=clips");
    expect(redirectUrl.searchParams.get("optional")).toBe("1");
  });

  it("sets anonymous cookie after featured session check, then allows with anon-id", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-1",
          visibility: "featured",
          ownerScopeId: null,
        },
      }),
    );

    // First visit — 302 redirect to set arena_anon cookie
    const req1 = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost", {
      headers: { cookie: "arena_consent=1; arena_auth_checked=1", "x-forwarded-uri": "/" },
    });
    const res1 = await GET(req1);
    expect(res1.status).toBe(302);
    const setCookie = res1.headers.get("set-cookie");
    expect(setCookie).toContain("arena_anon=");
    // Lax (not Strict) so the anon id survives arrival via a shared cross-site link.
    expect(setCookie).toContain("SameSite=Lax");

    // Second visit with cookie — 200 with X-Ralph-Anon-Id
    const anonCookie = setCookie!.split(";")[0]; // "arena_anon=<value>"
    const req2 = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost", {
      headers: { cookie: `arena_consent=1; arena_auth_checked=1; ${anonCookie}`, "x-forwarded-uri": "/" },
    });
    const res2 = await GET(req2);
    expect(res2.status).toBe(200);
    expect(res2.headers.get("X-Ralph-Anon-Id")).toBeTruthy();
    expect(res2.headers.get("X-Ralph-Anon-Id")).toHaveLength(16);
    expect(res2.headers.get("X-Arena-Project-Id")).toBe("project-1");
    expect(res2.headers.get("X-Arena-Project-Role")).toBe("public");
    expect(res2.headers.get("X-Arena-Project-Capabilities")).toBe("");
  });

  it("cleans the featured guest auth-check marker and sets stable anonymous identity", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-1",
          visibility: "featured",
          ownerScopeId: null,
        },
      }),
    );

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost", {
      headers: {
        cookie: "arena_consent=1",
        "x-forwarded-uri": "/aa325?tab=clips&arena_auth_checked=1",
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://preview-featured.localhost/aa325?tab=clips");
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((cookie: string) => cookie.startsWith("arena_auth_checked=1;"))).toBe(true);
    expect(setCookies.some((cookie: string) => cookie.startsWith("arena_anon="))).toBe(true);
  });

  it("shows interstitial for featured preview without consent cookie", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-1",
          visibility: "featured",
          ownerScopeId: null,
        },
      }),
    );
    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost");
    const response = await GET(request);
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("AI-Generated Content");
    expect(html).toContain("Continue");
  });

  it("skips the AI disclaimer interstitial for a featured project with showAiDisclaimer=false", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-1",
          visibility: "featured",
          showAiDisclaimer: false,
          ownerScopeId: null,
        },
      }),
    );
    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost");
    const response = await GET(request);
    // No consent interstitial — falls through to the optional identity-check redirect.
    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe("/api/auth/preview-redirect");
  });

  it("redirects a disclaimer-free public project straight to login instead of the interstitial", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-1",
          visibility: "public",
          showAiDisclaimer: false,
          ownerScopeId: null,
        },
      }),
    );
    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-public.localhost");
    const response = await GET(request);
    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    expect(new URL(location!).pathname).toBe("/api/auth/preview-redirect");
  });

  it("treats explicit embed previews as iframe requests even when the client omits fetch metadata", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-1",
          visibility: "featured",
          ownerScopeId: null,
        },
      }),
    );

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost", {
      headers: { "x-forwarded-uri": "/?arena_embed=1" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("X-Ralph-Anon-Id")).toBeTruthy();
  });

  it("issues an auth cookie redirect for private embedded preview with a valid arena_token", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-2",
          visibility: "private",
          ownerScopeId: "user-1",
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
    });

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-private.localhost", {
      headers: {
        "x-forwarded-uri": "/?arena_embed=1&arena_token=valid-token",
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(302);
    expect(peekHandoffCode).toHaveBeenCalledWith("valid-token", "project-2");
    expect(response.headers.get("location")).toBe("http://preview-private.localhost/?arena_embed=1");
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c: string) => c.startsWith("arena_auth="))).toBe(true);
    expect(setCookies.some((c: string) => c.startsWith("arena_consent="))).toBe(true);
  });

  it("issues partitioned embedded auth and consent cookies for secure private preview handoff", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-2",
          visibility: "private",
          ownerScopeId: "user-1",
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
    });

    const request = new NextRequest("https://localhost/api/auth/preview-gate?host=preview-private.example.com", {
      headers: {
        "x-forwarded-uri": "/?arena_embed=1&arena_token=valid-token",
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(302);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c: string) => /^arena_auth=.*SameSite=None; Secure/.test(c))).toBe(true);
    expect(setCookies.some((c: string) => /^arena_embed_auth=.*SameSite=None; Secure; Partitioned/.test(c))).toBe(true);
    expect(setCookies.some((c: string) => /^arena_embed_consent=1;.*SameSite=None; Secure; Partitioned/.test(c))).toBe(true);
  });

  it("issues an auth cookie redirect for featured embedded preview with a valid arena_token", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-featured",
          visibility: "featured",
          ownerScopeId: null,
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
    });

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost", {
      headers: {
        "x-forwarded-uri": "/?arena_embed=1&arena_token=valid-token",
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(302);
    expect(peekHandoffCode).toHaveBeenCalledWith("valid-token", "project-featured");
    expect(response.headers.get("location")).toBe("http://preview-featured.localhost/?arena_embed=1");
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c: string) => c.startsWith("arena_auth="))).toBe(true);
    expect(setCookies.some((c: string) => c.startsWith("arena_consent="))).toBe(true);
  });

  it("allows private preview with a valid arena_token and sets auth cookie", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-2",
          visibility: "private",
          ownerScopeId: "user-1",
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
    });

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-private.localhost", {
      headers: {
        "x-forwarded-uri": "/?arena_token=valid-token",
        cookie: "arena_consent=1",
      },
    });
    const response = await GET(request);

    // Source returns 302 redirect to deliver Set-Cookie headers via Caddy forward_auth
    expect(response.status).toBe(302);
    expect(peekHandoffCode).toHaveBeenCalledWith("valid-token", "project-2");
    // Should set auth cookie via redirect
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((c: string) => c.startsWith("arena_auth="))).toBe(true);
    expect(setCookies.some((c: string) => c.startsWith("arena_consent="))).toBe(true);
  });

  it("allows featured sub-resources anonymously", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-3",
          visibility: "featured",
          ownerScopeId: null,
        },
      }),
    );

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-featured.localhost", {
      headers: { "x-forwarded-uri": "/static/app.js" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ralph-Anon-Id")).toBeTruthy();
  });

  it("denies private sub-resources without preview auth", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-3",
          visibility: "private",
          ownerScopeId: null,
        },
      }),
    );

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-nosession.localhost", {
      headers: { "x-forwarded-uri": "/static/app.js" },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("denies public embedded preview without auth", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-public",
          visibility: "public",
          ownerScopeId: null,
        },
      }),
    );

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-public.localhost", {
      headers: { "x-forwarded-uri": "/?arena_embed=1" },
    });
    const response = await GET(request);
    expect(response.status).toBe(403);
    const html = await response.text();
    expect(html).toContain("Sign in");
  });

  it("allows private sub-resources with preview auth cookie", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-cookie",
          mode: "community",
          visibility: "private",
          ownerScopeType: "user",
          ownerScopeId: null,
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
    });

    const tokenRequest = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-cookie.localhost", {
      headers: {
        "x-forwarded-uri": "/?arena_embed=1&arena_token=valid-token",
      },
    });
    const tokenResponse = await GET(tokenRequest);
    const authCookie = tokenResponse.headers.getSetCookie().find((cookie: string) => cookie.startsWith("arena_auth="))!.split(";")[0];

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-cookie.localhost", {
      headers: {
        "x-forwarded-uri": "/static/app.js",
        cookie: authCookie,
      },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ralph-Anon-Id")).toBeTruthy();
  });

  it("injects project-scoped role and capabilities for authenticated preview requests", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-admin",
          mode: "community",
          visibility: "private",
          ownerScopeType: "user",
          ownerScopeId: null,
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "user-admin",
      email: "admin@example.com",
    });
    mocks.resolveProjectAccess.mockResolvedValueOnce({
      isOwner: false,
      canManage: true,
      sources: [{
        kind: "direct",
        scope: { type: "project", projectId: "project-admin", label: "project-admin" },
        label: "Project Manager",
        sourcePresetKey: "project_manager",
        grantId: "grant-1",
        capabilities: ["project.view", "project.secrets.manage"],
        state: "active",
        expiresAt: null,
        revokedAt: null,
      }],
      effectiveCapabilities: ["project.view", "project.secrets.manage"],
      hasCapability: (capability: string) => capability === "project.view",
    });

    const tokenRequest = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-admin.localhost", {
      headers: {
        "x-forwarded-uri": "/?arena_token=valid-token",
      },
    });
    const tokenResponse = await GET(tokenRequest);
    const authCookie = tokenResponse.headers.getSetCookie().find((cookie: string) => cookie.startsWith("arena_auth="))!.split(";")[0];

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-admin.localhost", {
      headers: {
        "x-forwarded-uri": "/admin/videos",
        cookie: `${authCookie}; arena_consent=1`,
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ralph-Anon-Id")).toBeTruthy();
    expect(response.headers.get("X-Arena-Project-Id")).toBe("project-admin");
    expect(response.headers.get("X-Arena-Project-Role")).toBe("admin");
    expect(response.headers.get("X-Arena-Project-Capabilities")).toBe("project.view,project.secrets.manage");
    expect(mocks.resolveProjectAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project-admin",
        visibility: "private",
      }),
      expect.objectContaining({
        user: expect.objectContaining({
          id: "user-admin",
          email: "admin@example.com",
        }),
      }),
      false,
    );
  });

  it("does not turn inherited platform access into generated-app admin headers", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-platform-admin",
          mode: "community",
          visibility: "private",
          ownerScopeType: "user",
          ownerScopeId: null,
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "platform-admin",
      email: "ops@example.com",
    });
    mocks.resolveProjectAccess.mockResolvedValueOnce({
      isOwner: false,
      canManage: true,
      sources: [{
        kind: "inherited",
        scope: { type: "platform", label: "Platform" },
        label: "via Ops Admin",
        sourcePresetKey: "ops_admin",
        grantId: "grant-platform",
        capabilities: ["project.view", "project.runtime.manage", "project.settings.manage"],
        state: "active",
        expiresAt: null,
        revokedAt: null,
      }],
      effectiveCapabilities: ["project.view", "project.runtime.manage", "project.settings.manage"],
      hasCapability: (capability: string) => capability === "project.view",
    });

    const tokenRequest = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-platform-admin.localhost", {
      headers: {
        "x-forwarded-uri": "/?arena_token=valid-token",
      },
    });
    const tokenResponse = await GET(tokenRequest);
    const authCookie = tokenResponse.headers.getSetCookie().find((cookie: string) => cookie.startsWith("arena_auth="))!.split(";")[0];

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-platform-admin.localhost", {
      headers: {
        "x-forwarded-uri": "/admin/videos",
        cookie: `${authCookie}; arena_consent=1`,
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Arena-Project-Id")).toBe("project-platform-admin");
    expect(response.headers.get("X-Arena-Project-Role")).toBe("viewer");
    expect(response.headers.get("X-Arena-Project-Capabilities")).toBe("");
  });

  it("allows private embedded app API requests with partitioned auth and consent cookies", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-cookie",
          visibility: "private",
          ownerScopeId: null,
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue({
      userId: "user-1",
      email: "user@example.com",
    });

    const tokenRequest = new NextRequest("https://localhost/api/auth/preview-gate?host=preview-cookie.example.com", {
      headers: {
        "x-forwarded-uri": "/?arena_embed=1&arena_token=valid-token",
      },
    });
    const tokenResponse = await GET(tokenRequest);
    const setCookies = tokenResponse.headers.getSetCookie();
    const authCookie = setCookies.find((cookie: string) => cookie.startsWith("arena_embed_auth="))!.split(";")[0];
    const consentCookie = setCookies.find((cookie: string) => cookie.startsWith("arena_embed_consent="))!.split(";")[0];

    const request = new NextRequest("https://localhost/api/auth/preview-gate?host=preview-cookie.example.com", {
      headers: {
        "x-forwarded-uri": "/api/feed",
        cookie: `${authCookie}; ${consentCookie}`,
      },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Ralph-Anon-Id")).toBeTruthy();
  });

  it("denies private preview without any auth", async () => {
    vi.mocked(prisma.projectComponent.findFirst).mockResolvedValue(
      mockPreviewComponent({
        project: {
          id: "project-4",
          visibility: "private",
          ownerScopeId: "other-user",
        },
      }),
    );
    vi.mocked(peekHandoffCode).mockReturnValue(null);

    const request = new NextRequest("http://localhost/api/auth/preview-gate?host=preview-noaccess.localhost", {
      headers: { "x-forwarded-uri": "/" },
    });
    const response = await GET(request);
    expect(response.status).toBe(403);
  });
});
