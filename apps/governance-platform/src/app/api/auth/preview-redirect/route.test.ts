import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/handoff-tokens", () => ({
  createHandoffCode: vi.fn(() => "handoff-code"),
}));

vi.mock("@/lib/project-access", () => ({
  resolveProjectAccess: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { createHandoffCode } from "@/lib/handoff-tokens";
import { prisma } from "@/lib/prisma";
import { resolveProjectAccess } from "@/lib/project-access";
import { GET } from "./route";

describe("preview-redirect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the guest featured preview redirect from the primary component runtime identity", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      mode: "APP",
      visibility: "featured",
      ownerScopeId: null,
      ownerScopeType: null,
      proposalId: null,
      components: [
        {
          kind: "app",
          previewUrl: null,
          containerName: "preview-demo",
        },
      ],
      vpsHost: { previewDomain: "arena.example.test" },
    } as any);
    vi.mocked(auth).mockResolvedValue(null as any);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/auth/preview-redirect?projectId=project-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview-demo.arena.example.test/?arena_auth_checked=1",
    );
    expect(createHandoffCode).not.toHaveBeenCalled();
  });

  it("preserves signed-in identity for featured preview redirects", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      mode: "APP",
      visibility: "featured",
      ownerScopeId: null,
      ownerScopeType: null,
      proposalId: null,
      components: [
        {
          kind: "app",
          previewUrl: null,
          containerName: "preview-demo",
        },
      ],
      vpsHost: { previewDomain: "arena.example.test" },
    } as any);
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
      },
    } as any);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/auth/preview-redirect?projectId=project-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview-demo.arena.example.test/?arena_token=handoff-code",
    );
    expect(createHandoffCode).toHaveBeenCalledWith("project-1", {
      id: "user-1",
      email: "user@example.com",
    });
  });

  it("preserves the final preview path when minting a signed-in handoff", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      mode: "APP",
      visibility: "featured",
      ownerScopeId: null,
      ownerScopeType: null,
      proposalId: null,
      components: [
        {
          kind: "app",
          previewUrl: null,
          containerName: "preview-demo",
        },
      ],
      vpsHost: { previewDomain: "arena.example.test" },
    } as any);
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
      },
    } as any);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/auth/preview-redirect?projectId=project-1&returnPath=%2Faa325%3Ftab%3Dclips%26arena_token%3Dstale",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview-demo.arena.example.test/aa325?tab=clips&arena_token=handoff-code",
    );
  });

  it("rejects unsafe returnPath values before redirecting to preview", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-1",
      mode: "APP",
      visibility: "featured",
      ownerScopeId: null,
      ownerScopeType: null,
      proposalId: null,
      components: [
        {
          kind: "app",
          previewUrl: null,
          containerName: "preview-demo",
        },
      ],
      vpsHost: { previewDomain: "arena.example.test" },
    } as any);
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
      },
    } as any);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/auth/preview-redirect?projectId=project-1&returnPath=https%3A%2F%2Fevil.example%2Faa325",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview-demo.arena.example.test/?arena_token=handoff-code",
    );
  });

  it("redirects unauthenticated public preview opens to sign-in", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-2",
      mode: "APP",
      visibility: "public",
      ownerScopeId: null,
      ownerScopeType: null,
      proposalId: null,
      components: [
        {
          kind: "app",
          previewUrl: "https://preview-space-invaders.arena.example.test",
          containerName: "preview-space-invaders",
        },
      ],
      vpsHost: { previewDomain: "arena.example.test" },
    } as any);
    vi.mocked(auth).mockResolvedValue(null as any);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/auth/preview-redirect?projectId=project-2",
      ),
    );

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toContain("/api/auth/signin?callbackUrl=");
  });

  it("preserves returnPath through the public preview sign-in callback", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-2",
      mode: "APP",
      visibility: "public",
      ownerScopeId: null,
      ownerScopeType: null,
      proposalId: null,
      components: [
        {
          kind: "app",
          previewUrl: "https://preview-space-invaders.arena.example.test",
          containerName: "preview-space-invaders",
        },
      ],
      vpsHost: { previewDomain: "arena.example.test" },
    } as any);
    vi.mocked(auth).mockResolvedValue(null as any);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/auth/preview-redirect?projectId=project-2&returnPath=%2Faa325%3Ftab%3Dclips",
      ),
    );

    const location = response.headers.get("location");
    expect(location).toBeTruthy();
    const callbackUrl = new URL(location!).searchParams.get("callbackUrl");
    expect(callbackUrl).toBeTruthy();
    expect(new URL(callbackUrl!).searchParams.get("returnPath")).toBe("/aa325?tab=clips");
  });

  it("denies private preview when the signed-in user lacks project access", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: "project-3",
      mode: "APP",
      visibility: "private",
      ownerScopeId: "owner-1",
      ownerScopeType: "USER",
      proposalId: null,
      components: [
        {
          kind: "app",
          previewUrl: "https://preview-private.arena.example.test",
          containerName: "preview-private",
        },
      ],
      vpsHost: { previewDomain: "arena.example.test" },
    } as any);
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "user-2",
        email: "user@example.com",
      },
    } as any);
    vi.mocked(resolveProjectAccess).mockResolvedValue({
      canAccessPrivate: false,
    } as any);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/auth/preview-redirect?projectId=project-3",
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Access denied");
  });
});
