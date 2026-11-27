import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/progress-bus", () => ({
  notifyProjectChanged: vi.fn(),
}));

vi.mock("@/lib/internal-auth", () => ({
  isEvolutionPushAuthorized: vi.fn(),
}));

vi.mock("@/lib/project-state-effects", () => ({
  applyStateChange: vi.fn(),
  getPrimaryComponentRow: vi.fn(),
}));

vi.mock("@/lib/project-update-outbox", () => ({
  enqueueProjectUpdate: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { isEvolutionPushAuthorized } from "@/lib/internal-auth";
import { applyStateChange, getPrimaryComponentRow } from "@/lib/project-state-effects";
import { enqueueProjectUpdate } from "@/lib/project-update-outbox";
import { buildTgSpecImportMetadata } from "@/lib/tg-spec-import-metadata";

function acceptedArtifactFixture({
  sourceProjectId = "tg-proj-1",
  sourceVersion = 1,
  markdown = "# Spec",
  summary,
  sourceUrl,
}: {
  sourceProjectId?: string;
  sourceVersion?: number;
  markdown?: string;
  summary?: string;
  sourceUrl?: string;
} = {}) {
  const suffix = String(sourceVersion).padStart(3, "0");
  const sourceRef = `SRC-${suffix}`;

  return {
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: `SPEC-${suffix}`,
    acceptedAt: "2026-05-16T12:00:00.000Z",
    source: {
      id: sourceRef,
      sourceSystem: "tg-spec",
      sourceProjectId,
      sourceVersion,
      sourceRefType: "accepted_spec",
      sourceId: `tg-spec-version-${sourceVersion}`,
      ...(sourceUrl ? { url: sourceUrl } : {}),
    },
    acceptedSpec: {
      id: `SPEC-${suffix}`,
      version: sourceVersion,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: markdown.replace(/^#\s*/, "").split("\n")[0]?.trim() || "Imported spec",
        sections: [],
        requirements: [],
        extensionBlocks: [],
      },
      renderedMarkdown: markdown,
      contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceRefs: [sourceRef],
    },
    acceptedDiff: {
      id: `DIFF-${suffix}`,
      baseSpecVersion: sourceVersion > 1 ? sourceVersion - 1 : undefined,
      targetSpecVersion: sourceVersion,
      summary: summary ?? `Imported tg-spec v${sourceVersion}`,
      items: [],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };
}

function primaryComponentRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "proj-1",
    componentId: "component-1",
    powerIntent: "OFF",
    agentIntent: "OFF",
    runtimeState: "ABSENT",
    agentState: null,
    blockers: [],
    lastOutcome: null,
    lastOutcomeAt: null,
    retryAt: null,
    previewHealth: "UNKNOWN",
    previewCheckedAt: null,
    provisionedAt: null,
    containerName: null,
    previewUrl: null,
    workerHost: null,
    vpsHostId: null,
    lastHeartbeat: null,
    retryCount: 0,
    archivedAt: null,
    tgSpecLastImportedVersion: null,
    sourceConfig: undefined,
    ...overrides,
  };
}

describe("POST /api/internal/tg-spec/projects/[projectId]/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEvolutionPushAuthorized).mockReturnValue(true);

    let powerIntent: "ON" | "OFF" = "OFF";
    let agentIntent: "ON" | "OFF" = "OFF";

    vi.mocked(getPrimaryComponentRow).mockImplementation(async () => primaryComponentRowFixture({
      powerIntent,
      agentIntent,
    }) as any);

    vi.mocked(applyStateChange).mockImplementation(async (_db, _projectId, change) => {
      if (change.type === "agentIntent") agentIntent = change.intent;
      if (change.type === "power") powerIntent = change.intent;

      return primaryComponentRowFixture({
        powerIntent,
        agentIntent,
      }) as any;
    });
  });

  it("rejects unauthorized requests", async () => {
    vi.mocked(isEvolutionPushAuthorized).mockReturnValue(false);

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 1,
          specMarkdown: "# Spec",
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(401);
  });

  it("creates the mirror spec on the first import", async () => {
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: "proposal-1",
            tgSpecSourceProjectId: null,
            tgSpecMirrorSpecId: null,
            tgSpecLastImportedVersion: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "tg_spec_target" },
          }),
        },
        spec: {
          findFirst: vi.fn().mockResolvedValue({ orderIndex: 2 }),
          create: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
          update: vi.fn(),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "spec-version-1", version: 1 }),
        },
      };

      const result = await callback(tx);

      expect(tx.spec.create).toHaveBeenCalledWith({
        data: {
          projectId: "proj-1",
          title: "Evolution Spec",
          content: "# Spec",
          orderIndex: 3,
        },
      });
      expect(tx.specVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          specId: "spec-mirror-1",
          version: 1,
          content: "# Spec",
          message: "Imported from tg-spec v7: Added multiplayer mode",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 7,
          acceptedArtifact: expect.objectContaining({
            artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
          }),
        }),
        select: { id: true, version: true },
      });
      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "proj-1" },
        data: {
          tgSpecSourceProjectId: "tg-proj-1",
          tgSpecMirrorSpecId: "spec-mirror-1",
          tgSpecLastImportedVersion: 7,
        },
      });
      expect(tx.spec.update).not.toHaveBeenCalled();

      return result;
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 7,
          specMarkdown: "# Spec",
          changeSummary: "Added multiplayer mode",
          acceptedArtifact: acceptedArtifactFixture({
            sourceVersion: 7,
            markdown: "# Spec",
            summary: "Added multiplayer mode",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      imported: true,
      duplicate: false,
      mirrorSpecId: "spec-mirror-1",
      sourceVersion: 7,
      specVersionId: "spec-version-1",
      specVersion: 1,
      metadataHash: expect.stringMatching(/^sha256:/),
      metadataStatus: "present",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/projects/proj-1");
    expect(revalidatePath).toHaveBeenCalledWith("/my/projects/proj-1");
    expect(revalidatePath).toHaveBeenCalledWith("/proposals/proposal-1");
    expect(notifyProjectChanged).toHaveBeenCalledWith("proj-1");
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        projectId: "proj-1",
        eventType: "spec.imported",
        dedupeKey: "tg-spec:tg-proj-1:v7",
      }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      "proj-1",
      { type: "agentIntent", intent: "ON" },
      expect.objectContaining({ trigger: "tg_spec_first_import_agent_on" }),
    );
    expect(applyStateChange).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      "proj-1",
      { type: "power", intent: "ON" },
      expect.objectContaining({ trigger: "tg_spec_first_import_power_on" }),
    );
  });

  it("does not auto-start a newly imported tg-spec project that still needs launch setup", async () => {
    vi.mocked(getPrimaryComponentRow).mockResolvedValue(primaryComponentRowFixture({
      sourceConfig: {
        recipe: "tg_spec_target",
        launchConfiguration: "tg_spec_launch_configuration_required",
      },
    }) as any);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: null,
            tgSpecMirrorSpecId: null,
            tgSpecLastImportedVersion: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: {
              recipe: "tg_spec_target",
              launchConfiguration: "tg_spec_launch_configuration_required",
            },
          }),
        },
        spec: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
          update: vi.fn(),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "spec-version-1", version: 1 }),
        },
      };

      return callback(tx);
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 1,
          specMarkdown: "# Spec",
          acceptedArtifact: acceptedArtifactFixture(),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("does not auto-start a newly imported tg-spec project that is configured but not explicitly started", async () => {
    vi.mocked(getPrimaryComponentRow).mockResolvedValue(primaryComponentRowFixture({
      sourceConfig: {
        recipe: "tg_spec_target",
        launchConfiguration: "tg_spec_launch_configuration_configured",
      },
    }) as any);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: null,
            tgSpecMirrorSpecId: null,
            tgSpecLastImportedVersion: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: {
              recipe: "tg_spec_target",
              launchConfiguration: "tg_spec_launch_configuration_configured",
            },
          }),
        },
        spec: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
          update: vi.fn(),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "spec-version-1", version: 1 }),
        },
      };

      return callback(tx);
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 1,
          specMarkdown: "# Spec",
          acceptedArtifact: acceptedArtifactFixture(),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("creates the first mirror spec after launch-time add-on specs", async () => {
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: null,
            tgSpecMirrorSpecId: null,
            tgSpecLastImportedVersion: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "tg_spec_target" },
          }),
        },
        spec: {
          findFirst: vi.fn().mockResolvedValue({ orderIndex: 0 }),
          create: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
          update: vi.fn(),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "spec-version-1", version: 1 }),
        },
      };

      const result = await callback(tx);

      expect(tx.spec.findFirst).toHaveBeenCalledWith({
        where: { projectId: "proj-1" },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
      });
      expect(tx.spec.create).toHaveBeenCalledWith({
        data: {
          projectId: "proj-1",
          title: "Evolution Spec",
          content: "# Product Spec",
          orderIndex: 1,
        },
      });
      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "proj-1" },
        data: {
          tgSpecSourceProjectId: "tg-proj-1",
          tgSpecMirrorSpecId: "spec-mirror-1",
          tgSpecLastImportedVersion: 1,
        },
      });
      expect(tx.spec.update).not.toHaveBeenCalled();

      return result;
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 1,
          specMarkdown: "# Product Spec",
          acceptedArtifact: acceptedArtifactFixture({
            sourceVersion: 1,
            markdown: "# Product Spec",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      imported: true,
      duplicate: false,
      mirrorSpecId: "spec-mirror-1",
      sourceVersion: 1,
    });
  });

  it("updates the existing mirror spec on newer imports", async () => {
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: "tg-proj-1",
            tgSpecMirrorSpecId: "spec-mirror-1",
            tgSpecLastImportedVersion: 6,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "agent_project" },
          }),
        },
        spec: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue({ version: 4 }),
          create: vi.fn().mockResolvedValue({ id: "spec-version-5", version: 5 }),
        },
      };

      const result = await callback(tx);

      expect(tx.spec.update).toHaveBeenCalledWith({
        where: { id: "spec-mirror-1" },
        data: {
          title: "Evolution Spec",
          content: "# Updated spec",
        },
      });
      expect(tx.specVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          specId: "spec-mirror-1",
          version: 5,
          content: "# Updated spec",
          message: "Imported from tg-spec v7",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 7,
          acceptedArtifact: expect.objectContaining({
            artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
          }),
        }),
        select: { id: true, version: true },
      });
      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "proj-1" },
        data: {
          tgSpecSourceProjectId: "tg-proj-1",
          tgSpecMirrorSpecId: "spec-mirror-1",
          tgSpecLastImportedVersion: 7,
        },
      });
      expect(tx.spec.create).not.toHaveBeenCalled();

      return result;
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 7,
          specMarkdown: "# Updated spec",
          acceptedArtifact: acceptedArtifactFixture({
            sourceVersion: 7,
            markdown: "# Updated spec",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      imported: true,
      duplicate: false,
    });
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("backfills a missing historical version without regressing the current mirror", async () => {
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: "tg-proj-1",
            tgSpecMirrorSpecId: "spec-mirror-1",
            tgSpecLastImportedVersion: 252,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({ sourceConfig: { recipe: "agent_project" } }),
        },
        spec: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
        specVersion: {
          findFirst: vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ version: 41 }),
          create: vi.fn().mockResolvedValue({ id: "spec-version-42", version: 42 }),
        },
      };

      const result = await callback(tx);

      expect(tx.specVersion.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          specId: "spec-mirror-1",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 251,
        },
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          content: true,
          externalMetadataHash: true,
        },
      });
      expect(tx.spec.update).not.toHaveBeenCalled();
      expect(tx.specVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          specId: "spec-mirror-1",
          version: 42,
          content: "# Historical v251",
          externalSourceVersion: 251,
        }),
        select: { id: true, version: true },
      });
      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "proj-1" },
        data: {
          tgSpecSourceProjectId: "tg-proj-1",
          tgSpecMirrorSpecId: "spec-mirror-1",
          tgSpecLastImportedVersion: 252,
        },
      });

      return result;
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 251,
          specMarkdown: "# Historical v251",
          acceptedArtifact: acceptedArtifactFixture({
            sourceVersion: 251,
            markdown: "# Historical v251",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      imported: true,
      duplicate: false,
      sourceVersion: 251,
      specVersionId: "spec-version-42",
    });
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("rejects legacy package schema v2 metadata instead of adapting it", async () => {
    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageSchemaVersion: 2,
          sourceProjectId: "tg-proj-1",
          sourceVersion: 8,
          specMarkdown: "# Updated spec",
          acceptedDelta: {
            schemaVersion: 1,
            kind: "accepted_spec_delta",
            sourceSystem: "tg-spec",
            sourceProjectId: "tg-proj-1",
            sourceVersion: 8,
            items: [],
          },
          sourceProvenance: {
            schemaVersion: 1,
            sourceSystem: "tg-spec",
            sourceProjectId: "tg-proj-1",
            sourceVersion: 8,
            sourceMessageIds: [],
            evidence: [],
          },
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid request",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("accepts v1 acceptedArtifact metadata through the same import boundary", async () => {
    const acceptedArtifact = {
      artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
      artifactId: "SPEC-009",
      acceptedAt: "2026-05-16T12:00:00.000Z",
      source: {
        id: "SRC-009",
        sourceSystem: "tg-spec",
        sourceProjectId: "tg-proj-1",
        sourceVersion: 9,
        sourceRefType: "accepted_spec",
        sourceId: "tg-spec-version-9",
        url: "https://tg-spec.example/projects/tg-proj-1/specs/9",
      },
      acceptedSpec: {
        id: "SPEC-009",
        version: 9,
        document: {
          specSchemaVersion: "ra-287.spec-document.v1",
          title: "Updated spec",
          sections: [],
          requirements: [{
            id: "REQ-001",
            kind: "functional",
            title: "Main flow",
            statement: "Build the updated app.",
            priority: "normal",
            acceptanceCriteria: ["Preview opens."],
            sourceRefs: ["SRC-009"],
          }],
          extensionBlocks: [],
        },
        renderedMarkdown: "# Updated spec",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourceRefs: ["SRC-009"],
      },
      acceptedDiff: {
        id: "DIFF-009",
        baseSpecVersion: 8,
        targetSpecVersion: 9,
        summary: "BUG-001 reopened",
        items: [{
          id: "DIFF-009-001",
          targetType: "feedback",
          targetId: "BUG-001",
          changeType: "reopened",
          workImpact: "requires_loop_work",
          summary: "Users report the bug still happens.",
          sourceRefs: ["SRC-009"],
        }],
      },
      feedback: [{
        id: "BUG-001",
        title: "Main chat moderation",
        body: "Users report the bug still happens.",
        state: "reopened",
        reopenCount: 2,
        defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
        sourceRefs: ["SRC-009"],
      }],
      assumptions: [],
      secretRequirements: [],
      assets: [],
    };

    let specVersionCreate: any;
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: "tg-proj-1",
            tgSpecMirrorSpecId: "spec-mirror-1",
            tgSpecLastImportedVersion: 8,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "agent_project" },
          }),
        },
        spec: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue({ version: 6 }),
          create: vi.fn().mockResolvedValue({ id: "spec-version-7", version: 7 }),
        },
      };
      specVersionCreate = tx.specVersion.create;
      return callback(tx);
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 9,
          specMarkdown: "# Updated spec",
          changeSummary: "BUG-001 reopened",
          sourceUrl: "https://tg-spec.example/projects/tg-proj-1/specs/9",
          acceptedArtifact,
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      imported: true,
      duplicate: false,
      specVersionId: "spec-version-7",
      specVersion: 7,
      metadataStatus: "present",
    });
    expect(specVersionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acceptedArtifact,
        externalSourceSystem: "tg-spec",
        externalSourceProjectId: "tg-proj-1",
        externalSourceVersion: 9,
        externalSourceUrl: "https://tg-spec.example/projects/tg-proj-1/specs/9",
        externalAcceptedAt: new Date("2026-05-16T12:00:00.000Z"),
      }),
      select: { id: true, version: true },
    });
    expect(specVersionCreate.mock.calls[0][0].data).not.toHaveProperty("acceptedDelta");
    expect(specVersionCreate.mock.calls[0][0].data).not.toHaveProperty("externalProvenance");
    const metadataHash = specVersionCreate.mock.calls[0][0].data.externalMetadataHash;
    expect(metadataHash).toMatch(/^sha256:/);
    expect(enqueueProjectUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payload: expect.objectContaining({
          diffItemCount: 1,
          diffItemIds: ["BUG-001"],
          workItemCount: 1,
          workItemIds: ["BUG-001"],
          reopenedItemIds: ["BUG-001"],
          metadataHash,
          metadataStatus: "present",
        }),
      }),
    );
  });

  it("rejects acceptedArtifact metadata when artifact source conflicts with the import source", async () => {
    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 8,
          specMarkdown: "# Updated spec",
          acceptedArtifact: acceptedArtifactFixture({
            sourceProjectId: "tg-proj-other",
            sourceVersion: 8,
            markdown: "# Updated spec",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid tg-spec metadata",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects acceptedArtifact metadata when it contains secret-looking content", async () => {
    const acceptedArtifact = acceptedArtifactFixture({
      sourceVersion: 8,
      markdown: "# Updated spec",
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 8,
          specMarkdown: "# Updated spec",
          acceptedArtifact: {
            ...acceptedArtifact,
            acceptedSpec: {
              ...acceptedArtifact.acceptedSpec,
              document: {
                ...acceptedArtifact.acceptedSpec.document,
                requirements: [{
                  id: "REQ-SECRET",
                  kind: "functional",
                  title: "Secret leak",
                  statement: "The real token is sk-proj-abcdefghijklmnopqrstuvwxyz123456",
                  priority: "high",
                  acceptanceCriteria: ["Never import this."],
                  sourceRefs: ["SRC-008"],
                }],
              },
            },
          },
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid request",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects unknown import metadata fields instead of silently dropping them", async () => {
    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 8,
          specMarkdown: "# Updated spec",
          specDelta: { items: [] },
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Invalid request",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("clears MANUAL evidence blockers on fresh tg-spec imports so Ralph can process new feedback", async () => {
    vi.mocked(getPrimaryComponentRow).mockResolvedValue({
      projectId: "proj-1",
      componentId: "component-1",
      powerIntent: "ON",
      agentIntent: "ON",
      runtimeState: "RUNNING",
      agentState: "IDLE",
      blockers: ["MANUAL"],
      lastOutcome: null,
      lastOutcomeAt: null,
      retryAt: null,
      previewHealth: "HEALTHY",
      previewCheckedAt: null,
      provisionedAt: null,
      containerName: "preview-proj-1",
      previewUrl: "https://preview.example.com",
      workerHost: "local",
      vpsHostId: null,
      lastHeartbeat: null,
      retryCount: 0,
      archivedAt: null,
    });
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: "tg-proj-1",
            tgSpecMirrorSpecId: "spec-mirror-1",
            tgSpecLastImportedVersion: 7,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "agent_project" },
          }),
        },
        spec: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue({ version: 5 }),
          create: vi.fn().mockResolvedValue({ id: "spec-version-6", version: 6 }),
        },
      };
      return callback(tx);
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 8,
          specMarkdown: "# Updated spec\n\n## Implementation Gaps\n- BUG-001 (reopened#2): still failing",
          changeSummary: "BUG-001 still failing in production",
          acceptedArtifact: acceptedArtifactFixture({
            sourceVersion: 8,
            markdown: "# Updated spec\n\n## Implementation Gaps\n- BUG-001 (reopened#2): still failing",
            summary: "BUG-001 still failing in production",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.any(Object),
      "proj-1",
      { type: "removeBlocker", blocker: "MANUAL" },
      expect.objectContaining({
        source: "system",
        trigger: "tg_spec_import_manual_evidence_received",
      }),
    );
  });

  it("updates the existing imported source version on retry", async () => {
    vi.mocked(getPrimaryComponentRow).mockResolvedValue(primaryComponentRowFixture({
      blockers: ["MANUAL"],
    }) as any);
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: "tg-proj-1",
            tgSpecMirrorSpecId: "spec-mirror-1",
            tgSpecLastImportedVersion: 7,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "agent_project" },
          }),
        },
        spec: {
          findFirst: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({
            title: "Evolution Spec",
            content: "# Repaired spec",
          }),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: "spec-version-5",
            version: 5,
            content: "# Previous spec",
            externalMetadataHash: "sha256:previous",
          }),
          create: vi.fn(),
          update: vi.fn().mockResolvedValue({ id: "spec-version-5", version: 5 }),
        },
      };

      const result = await callback(tx);

      expect(tx.spec.findUnique).toHaveBeenCalledWith({
        where: { id: "spec-mirror-1" },
        select: { title: true, content: true },
      });
      expect(tx.spec.update).not.toHaveBeenCalled();
      expect(tx.specVersion.findFirst).toHaveBeenCalledWith({
        where: {
          specId: "spec-mirror-1",
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: "tg-proj-1",
          externalSourceVersion: 7,
        },
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          content: true,
          externalMetadataHash: true,
        },
      });
      expect(tx.specVersion.update).toHaveBeenCalledWith({
        where: { id: "spec-version-5" },
        data: expect.objectContaining({
          content: "# Repaired spec",
          message: "Imported from tg-spec v7",
          acceptedArtifact: expect.objectContaining({
            artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
          }),
        }),
        select: { id: true, version: true },
      });
      expect(tx.specVersion.create).not.toHaveBeenCalled();
      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: "proj-1" },
        data: {
          tgSpecSourceProjectId: "tg-proj-1",
          tgSpecMirrorSpecId: "spec-mirror-1",
          tgSpecLastImportedVersion: 7,
        },
      });

      return result;
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 7,
          specMarkdown: "# Repaired spec",
          acceptedArtifact: acceptedArtifactFixture({
            sourceVersion: 7,
            markdown: "# Repaired spec",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    const payload = await res.json();
    expect(res.status, JSON.stringify(payload)).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      imported: false,
      updated: true,
      duplicate: false,
      sourceVersion: 7,
      specVersionId: "spec-version-5",
      specVersion: 5,
    });
    expect(notifyProjectChanged).toHaveBeenCalledWith("proj-1");
    expect(enqueueProjectUpdate).not.toHaveBeenCalled();
    expect(applyStateChange).toHaveBeenCalledWith(
      expect.any(Object),
      "proj-1",
      { type: "removeBlocker", blocker: "MANUAL" },
      expect.objectContaining({ trigger: "tg_spec_import_manual_evidence_received" }),
    );
  });

  it("returns duplicate for an identical same-version accepted artifact retry", async () => {
    const acceptedArtifact = acceptedArtifactFixture({
      sourceVersion: 7,
      markdown: "# Repaired spec",
    });
    const metadataHash = buildTgSpecImportMetadata({
      sourceProjectId: "tg-proj-1",
      sourceVersion: 7,
      specMarkdown: "# Repaired spec",
      acceptedArtifact,
    }).metadataHash;

    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: "tg-proj-1",
            tgSpecMirrorSpecId: "spec-mirror-1",
            tgSpecLastImportedVersion: 7,
          }),
          update: vi.fn(),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "agent_project" },
          }),
        },
        spec: {
          findFirst: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({
            title: "Evolution Spec",
            content: "# Repaired spec",
          }),
          create: vi.fn(),
          update: vi.fn(),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: "spec-version-5",
            version: 5,
            content: "# Repaired spec",
            externalMetadataHash: metadataHash,
          }),
          create: vi.fn(),
          update: vi.fn(),
        },
      };

      const result = await callback(tx);

      expect(tx.spec.update).not.toHaveBeenCalled();
      expect(tx.specVersion.update).not.toHaveBeenCalled();
      expect(tx.specVersion.create).not.toHaveBeenCalled();
      expect(tx.project.update).not.toHaveBeenCalled();
      return result;
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 7,
          specMarkdown: "# Repaired spec",
          acceptedArtifact,
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    await expect(res.json()).resolves.toEqual({
      ok: true,
      imported: false,
      duplicate: true,
    });
    expect(notifyProjectChanged).not.toHaveBeenCalled();
    expect(enqueueProjectUpdate).not.toHaveBeenCalled();
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("rejects imports from a different tg-spec project", async () => {
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: "tg-proj-existing",
            tgSpecMirrorSpecId: "spec-mirror-1",
            tgSpecLastImportedVersion: 7,
          }),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "agent_project" },
          }),
        },
      };
      return callback(tx);
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-other",
          sourceVersion: 8,
          specMarkdown: "# Different source",
          acceptedArtifact: acceptedArtifactFixture({
            sourceProjectId: "tg-proj-other",
            sourceVersion: 8,
            markdown: "# Different source",
          }),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Project already bound to a different tg-spec source",
      sourceProjectId: "tg-proj-existing",
    });
  });

  it("rejects the first import for projects that are not marked as tg-spec targets", async () => {
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: null,
            tgSpecMirrorSpecId: null,
            tgSpecLastImportedVersion: null,
          }),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "agent_project" },
          }),
        },
      };
      return callback(tx);
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 1,
          specMarkdown: "# Spec",
          acceptedArtifact: acceptedArtifactFixture(),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Project is not configured as a tg-spec target",
    });
    expect(applyStateChange).not.toHaveBeenCalled();
  });

  it("accepts the first import when the app component is found through the explicit app lookup", async () => {
    vi.mocked(prisma.$transaction as any).mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        project: {
          findUnique: vi.fn().mockResolvedValue({
            id: "proj-1",
            proposalId: null,
            tgSpecSourceProjectId: null,
            tgSpecMirrorSpecId: null,
            tgSpecLastImportedVersion: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        projectComponent: {
          findFirst: vi.fn().mockResolvedValue({
            sourceConfig: { recipe: "tg_spec_target" },
          }),
        },
        spec: {
          findFirst: vi.fn().mockResolvedValue({ orderIndex: 0 }),
          create: vi.fn().mockResolvedValue({ id: "spec-mirror-1" }),
          update: vi.fn(),
        },
        specVersion: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "spec-version-1", version: 1 }),
        },
      };

      const result = await callback(tx);

      expect(tx.projectComponent.findFirst).toHaveBeenCalledWith({
        where: {
          projectId: "proj-1",
          kind: "app",
        },
        orderBy: { createdAt: "asc" },
        select: {
          sourceConfig: true,
        },
      });

      return result;
    });

    const res = await POST(
      new Request("http://localhost/api/internal/tg-spec/projects/proj-1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceProjectId: "tg-proj-1",
          sourceVersion: 1,
          specMarkdown: "# Spec",
          acceptedArtifact: acceptedArtifactFixture(),
        }),
      }),
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );

    expect(res.status).toBe(200);
  });
});
