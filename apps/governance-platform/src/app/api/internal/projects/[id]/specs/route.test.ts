import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { GET } from "./route";

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    spec: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/internal-auth", () => ({
  isRunnerAuthorized: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { isRunnerAuthorized } from "@/lib/internal-auth";

describe("GET /api/internal/projects/:id/specs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isRunnerAuthorized).mockReturnValue(true);
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue({ id: "proj-1" });
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([]);
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isRunnerAuthorized).mockReturnValue(false);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/specs"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(401);
    expect(isRunnerAuthorized).toHaveBeenCalledWith(expect.any(Request), { projectId: "proj-1" });
  });

  it("returns not found for unknown projects", async () => {
    vi.mocked(prisma.project.findUnique as any).mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/specs"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );

    expect(res.status).toBe(404);
  });

  it("returns the shared runner spec payload with accepted metadata", async () => {
    vi.mocked(prisma.spec.findMany as any).mockResolvedValue([{
      id: "spec-1",
      title: "Evolution Spec",
      content: "Build it",
      orderIndex: 0,
      updatedAt: new Date("2026-05-15T09:00:00.000Z"),
      versions: [{
        id: "spec-version-2",
        version: 2,
        message: "Imported from tg-spec v8",
        createdAt: new Date("2026-05-15T09:00:00.000Z"),
        externalSourceSystem: "tg-spec",
        externalSourceProjectId: "tg-proj-1",
        externalSourceVersion: 8,
        externalSourceUrl: "https://tg-spec.example/projects/tg-proj-1/specs/8",
        externalAcceptedAt: new Date("2026-05-15T08:59:00.000Z"),
        externalMetadataHash: "sha256:metadata-a",
        acceptedArtifact: {
          artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
          artifactId: "SPEC-008",
          acceptedAt: "2026-05-15T08:59:00.000Z",
          source: {
            id: "SRC-008",
            sourceSystem: "tg-spec",
            sourceProjectId: "tg-proj-1",
            sourceVersion: 8,
            sourceRefType: "accepted_spec",
            sourceId: "tg-spec-version-8",
          },
          acceptedSpec: {
            id: "SPEC-008",
            version: 8,
            document: {
              specSchemaVersion: "ra-287.spec-document.v1",
              title: "Evolution Spec",
              sections: [],
              requirements: [],
              extensionBlocks: [],
            },
            renderedMarkdown: "Build it",
            contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            sourceRefs: ["SRC-008"],
          },
          acceptedDiff: {
            id: "DIFF-008",
            targetSpecVersion: 8,
            summary: "BUG-001 reopened",
            items: [],
          },
          feedback: [],
          assumptions: [],
          secretRequirements: [],
          assets: [],
        },
      }],
    }]);

    const res = await GET(
      new Request("http://localhost/api/internal/projects/proj-1/specs"),
      { params: Promise.resolve({ id: "proj-1" }) },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.specs[0]).toMatchObject({
      id: "spec-1",
      slug: "Evolution Spec",
      content: "Build it",
      hash: expect.any(String),
      inputHash: expect.any(String),
      metadataHash: "sha256:metadata-a",
      currentVersion: {
        id: "spec-version-2",
        version: 2,
      },
      source: {
        system: "tg-spec",
        projectId: "tg-proj-1",
        version: 8,
      },
    });
    expect(body.hash).toBe(md5(body.specs[0].inputHash));
  });
});
