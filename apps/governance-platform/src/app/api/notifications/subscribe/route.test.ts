import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "./route";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/errors", () => ({
  logError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    newsletterSubscriber: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

function postRequest(body: unknown, origin?: string) {
  return new Request("http://localhost/api/notifications/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("/api/notifications/subscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the production landing origin to preflight newsletter subscriptions", async () => {
    const response = await OPTIONS(new Request("http://localhost/api/notifications/subscribe", {
      method: "OPTIONS",
      headers: {
        Origin: "https://arena.example.test",
        "Access-Control-Request-Method": "POST",
      },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://arena.example.test");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("rejects unknown browser origins at preflight", async () => {
    const response = await OPTIONS(new Request("http://localhost/api/notifications/subscribe", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("creates a landing subscriber and returns CORS headers for the public site", async () => {
    vi.mocked(prisma.newsletterSubscriber.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.newsletterSubscriber.create).mockResolvedValue({ id: "sub-1" } as any);

    const response = await POST(postRequest(
      { email: "Reader@Example.com ", source: "landing" },
      "https://arena.example.test",
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://arena.example.test");
    expect(body).toEqual({ ok: true, status: "subscribed" });
    expect(prisma.newsletterSubscriber.create).toHaveBeenCalledWith({
      data: { email: "reader@example.com", source: "landing" },
    });
  });

  it("preserves same-origin subscription behavior without CORS headers", async () => {
    vi.mocked(prisma.newsletterSubscriber.findUnique).mockResolvedValue({
      email: "reader@example.com",
      status: "ACTIVE",
    } as any);

    const response = await POST(postRequest({ email: "reader@example.com", source: "platform" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(body).toEqual({ ok: true, status: "already_subscribed" });
  });
});
