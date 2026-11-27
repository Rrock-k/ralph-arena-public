import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { listSshKeys, deleteSshKey } from "@/lib/vps/hetzner";

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    vpsHost: { findMany: vi.fn() },
  };
  return { prisma };
});

vi.mock("@/lib/internal-auth", () => ({
  isCronAuthorized: () => true,
}));

vi.mock("@/lib/vps/hetzner", () => ({
  listSshKeys: vi.fn(),
  deleteSshKey: vi.fn(),
}));

import { prisma } from "@/lib/prisma";

describe("POST /api/cron/cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HETZNER_API_TOKEN;
  });

  it("returns zero when Hetzner cleanup is disabled", async () => {
    const req = new Request("http://localhost/api/cron/cleanup", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toEqual({ orphanedKeysDeleted: 0 });
    expect(listSshKeys).not.toHaveBeenCalled();
  });

  it("deletes orphaned arena ssh keys", async () => {
    process.env.HETZNER_API_TOKEN = "token";
    vi.mocked((prisma as any).vpsHost.findMany).mockResolvedValue([
      { providerKeyId: "2" },
    ]);
    vi.mocked(listSshKeys).mockResolvedValue([
      { id: "1", name: "arena-old" },
      { id: "2", name: "arena-active" },
      { id: "3", name: "manual-key" },
    ] as any);
    vi.mocked(deleteSshKey).mockResolvedValue(undefined as any);

    const req = new Request("http://localhost/api/cron/cleanup", { method: "POST" });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toEqual({ orphanedKeysDeleted: 1 });
    expect(deleteSshKey).toHaveBeenCalledTimes(1);
    expect(deleteSshKey).toHaveBeenCalledWith("token", "1");
  });
});
