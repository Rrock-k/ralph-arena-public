import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AcceptedSpecArtifactSchema } from "@arena/contracts";
import { prisma } from "@/lib/prisma";
import { applyStateChange, getPrimaryComponentRow } from "@/lib/project-state-effects";
import { hasTgSpecLaunchConfigurationGate, isTgSpecTargetSourceConfig } from "@/lib/tg-spec-target";
import { enqueueProjectUpdate } from "@/lib/project-update-outbox";
import { buildTgSpecImportMetadata } from "@/lib/tg-spec-import-metadata";

export const TgSpecAcceptedArtifactImportRequestSchema = z.object({
  packageSchemaVersion: z.literal(1).optional(),
  sourceProjectId: z.string().trim().min(1),
  sourceVersion: z.number().int().positive(),
  specMarkdown: z.string().trim().min(1),
  changeSummary: z.string().trim().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  acceptedArtifact: AcceptedSpecArtifactSchema,
}).strict();

const MIRROR_SPEC_TITLE = "Evolution Spec";
const IMPORT_TRANSACTION_OPTIONS = {
  maxWait: 15_000,
  timeout: 30_000,
};

type TransactionClient = Prisma.TransactionClient;
export type TgSpecAcceptedArtifactImportRequest = z.infer<typeof TgSpecAcceptedArtifactImportRequestSchema>;

export type TgSpecAcceptedArtifactImportResult =
  | { kind: "not_found" }
  | { kind: "source_mismatch"; sourceProjectId: string }
  | { kind: "duplicate" }
  | { kind: "target_required" }
  | {
      kind: "imported" | "updated";
      projectId: string;
      proposalId: string | null;
      mirrorSpecId: string;
      sourceVersion: number;
      specVersionId: string;
      specVersion: number;
      metadataHash: string;
      metadataStatus: "present";
    };

function buildVersionMessage(sourceVersion: number, changeSummary?: string) {
  const summary = changeSummary?.trim();
  return summary
    ? `Imported from tg-spec v${sourceVersion}: ${summary}`
    : `Imported from tg-spec v${sourceVersion}`;
}

async function autoStartFirstImportedSpec(tx: TransactionClient, projectId: string) {
  let primaryComponent = await getPrimaryComponentRow(tx, projectId);
  if (
    !primaryComponent
    || primaryComponent.blockers.length > 0
    || hasTgSpecLaunchConfigurationGate(primaryComponent.sourceConfig)
  ) {
    return;
  }

  if (primaryComponent.agentIntent !== "ON") {
    primaryComponent = await applyStateChange(
      tx,
      projectId,
      { type: "agentIntent", intent: "ON" },
      {
        source: "system",
        trigger: "tg_spec_first_import_agent_on",
        reason: "First tg-spec import arms the execution target",
      },
    );
  }

  if (primaryComponent.powerIntent !== "ON") {
    await applyStateChange(
      tx,
      projectId,
      { type: "power", intent: "ON" },
      {
        source: "system",
        trigger: "tg_spec_first_import_power_on",
        reason: "First tg-spec import powers on the execution target",
      },
    );
  }
}

async function clearManualEvidenceBlockerForFreshSpec(tx: TransactionClient, projectId: string) {
  const primaryComponent = await getPrimaryComponentRow(tx, projectId);
  if (!primaryComponent?.blockers.includes("MANUAL")) return;

  await applyStateChange(
    tx,
    projectId,
    { type: "removeBlocker", blocker: "MANUAL" },
    {
      source: "system",
      trigger: "tg_spec_import_manual_evidence_received",
      reason: "Fresh tg-spec import supplies current user or production evidence",
    },
  );
}

export async function importTgSpecAcceptedArtifact(
  projectId: string,
  body: TgSpecAcceptedArtifactImportRequest,
): Promise<TgSpecAcceptedArtifactImportResult> {
  const importMetadata = buildTgSpecImportMetadata(body);

  return prisma.$transaction(async (tx: TransactionClient) => {
    const [project, primaryComponent] = await Promise.all([
      tx.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          proposalId: true,
          tgSpecSourceProjectId: true,
          tgSpecMirrorSpecId: true,
          tgSpecLastImportedVersion: true,
        },
      }),
      tx.projectComponent.findFirst({
        where: {
          projectId,
          kind: "app",
        },
        orderBy: { createdAt: "asc" },
        select: {
          sourceConfig: true,
        },
      }),
    ]);

    if (!project) {
      return { kind: "not_found" as const };
    }

    if (
      project.tgSpecSourceProjectId
      && project.tgSpecSourceProjectId !== body.sourceProjectId
    ) {
      return {
        kind: "source_mismatch" as const,
        sourceProjectId: project.tgSpecSourceProjectId,
      };
    }

    const isLegacyBoundProject = project.tgSpecSourceProjectId != null;
    if (!isLegacyBoundProject && !isTgSpecTargetSourceConfig(primaryComponent?.sourceConfig)) {
      return { kind: "target_required" as const };
    }

    const lastImportedVersion = project.tgSpecLastImportedVersion;
    const isHistoricalImport = lastImportedVersion != null && body.sourceVersion < lastImportedVersion;
    const isSameImportedVersion = lastImportedVersion === body.sourceVersion;
    const isFirstImportedVersion = project.tgSpecLastImportedVersion == null;
    const retainedLastImportedVersion = Math.max(lastImportedVersion ?? 0, body.sourceVersion);
    let mirrorSpecId = project.tgSpecMirrorSpecId;
    let mirrorSpecUpdated = false;
    let importedSpecVersion: {
      id: string;
      version: number;
      content: string;
      externalMetadataHash: string | null;
    } | null = null;

    if (lastImportedVersion != null && body.sourceVersion <= lastImportedVersion) {
      if (!mirrorSpecId) {
        return { kind: "duplicate" as const };
      }

      importedSpecVersion = await tx.specVersion.findFirst({
        where: {
          specId: mirrorSpecId,
          externalSourceSystem: "tg-spec",
          externalSourceProjectId: body.sourceProjectId,
          externalSourceVersion: body.sourceVersion,
        },
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          content: true,
          externalMetadataHash: true,
        },
      });

      if (isSameImportedVersion && !importedSpecVersion) {
        return { kind: "duplicate" as const };
      }
    }

    if (!mirrorSpecId) {
      const lastSpec = await tx.spec.findFirst({
        where: { projectId },
        orderBy: { orderIndex: "desc" },
        select: { orderIndex: true },
      });

      const createdMirror = await tx.spec.create({
        data: {
          projectId,
          title: MIRROR_SPEC_TITLE,
          content: body.specMarkdown,
          orderIndex: (lastSpec?.orderIndex ?? -1) + 1,
        },
      });

      mirrorSpecId = createdMirror.id;
    } else {
      let shouldUpdateMirrorSpec = !isHistoricalImport && !isSameImportedVersion;
      if (isSameImportedVersion) {
        const existingMirrorSpec = await tx.spec.findUnique({
          where: { id: mirrorSpecId },
          select: { title: true, content: true },
        });
        shouldUpdateMirrorSpec = existingMirrorSpec?.title !== MIRROR_SPEC_TITLE
          || existingMirrorSpec?.content !== body.specMarkdown;
      }

      if (shouldUpdateMirrorSpec) {
        await tx.spec.update({
          where: { id: mirrorSpecId },
          data: {
            title: MIRROR_SPEC_TITLE,
            content: body.specMarkdown,
          },
        });
        mirrorSpecUpdated = true;
      }
    }

    if (importedSpecVersion && mirrorSpecId) {
      const sameAcceptedInput =
        importedSpecVersion.content === body.specMarkdown
        && importedSpecVersion.externalMetadataHash === importMetadata.metadataHash;
      if (sameAcceptedInput && !mirrorSpecUpdated) {
        return { kind: "duplicate" as const };
      }

      const updatedSpecVersion = await tx.specVersion.update({
        where: { id: importedSpecVersion.id },
        data: {
          content: body.specMarkdown,
          message: buildVersionMessage(body.sourceVersion, body.changeSummary),
          externalSourceUrl: importMetadata.sourceUrl,
          externalAcceptedAt: importMetadata.acceptedAt,
          externalMetadataHash: importMetadata.metadataHash,
          acceptedArtifact: importMetadata.acceptedArtifact,
        } as any,
        select: { id: true, version: true },
      });

      if (!isHistoricalImport) {
        await clearManualEvidenceBlockerForFreshSpec(tx, projectId);
      }

      await tx.project.update({
        where: { id: projectId },
        data: {
          tgSpecSourceProjectId: project.tgSpecSourceProjectId ?? body.sourceProjectId,
          tgSpecMirrorSpecId: mirrorSpecId,
          tgSpecLastImportedVersion: retainedLastImportedVersion,
        },
      });

      return {
        kind: "updated" as const,
        projectId,
        proposalId: project.proposalId,
        mirrorSpecId,
        sourceVersion: body.sourceVersion,
        specVersionId: updatedSpecVersion.id,
        specVersion: updatedSpecVersion.version,
        metadataHash: importMetadata.metadataHash,
        metadataStatus: "present" as const,
      };
    }

    const lastVersion = await tx.specVersion.findFirst({
      where: { specId: mirrorSpecId },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    const createdSpecVersion = await tx.specVersion.create({
      data: {
        specId: mirrorSpecId,
        version: (lastVersion?.version ?? 0) + 1,
        content: body.specMarkdown,
        message: buildVersionMessage(body.sourceVersion, body.changeSummary),
        externalSourceSystem: "tg-spec",
        externalSourceProjectId: body.sourceProjectId,
        externalSourceVersion: body.sourceVersion,
        externalSourceUrl: importMetadata.sourceUrl,
        externalAcceptedAt: importMetadata.acceptedAt,
        externalMetadataHash: importMetadata.metadataHash,
        acceptedArtifact: importMetadata.acceptedArtifact,
      } as any,
      select: { id: true, version: true },
    });

    await tx.project.update({
      where: { id: projectId },
      data: {
        tgSpecSourceProjectId: project.tgSpecSourceProjectId ?? body.sourceProjectId,
        tgSpecMirrorSpecId: mirrorSpecId,
        tgSpecLastImportedVersion: retainedLastImportedVersion,
      },
    });

    if (!isHistoricalImport) {
      await clearManualEvidenceBlockerForFreshSpec(tx, projectId);
    }

    if (isFirstImportedVersion) {
      await autoStartFirstImportedSpec(tx, projectId);
    }

    await enqueueProjectUpdate(tx, {
      projectId,
      eventType: "spec.imported",
      dedupeKey: `tg-spec:${body.sourceProjectId}:v${body.sourceVersion}`,
      payload: {
        sourceProjectId: body.sourceProjectId,
        sourceVersion: body.sourceVersion,
        changeSummary: body.changeSummary,
        sourceUrl: importMetadata.sourceUrl,
        specId: mirrorSpecId,
        specVersionId: createdSpecVersion.id,
        specVersion: createdSpecVersion.version,
        acceptedAt: importMetadata.acceptedAt?.toISOString(),
        importedAt: new Date().toISOString(),
        diffItemCount: importMetadata.diffItemCount,
        diffItemIds: importMetadata.diffItemIds,
        workItemCount: importMetadata.workItemCount,
        workItemIds: importMetadata.workItemIds,
        reopenedItemIds: importMetadata.reopenedItemIds,
        metadataHash: importMetadata.metadataHash,
        metadataStatus: "present",
      },
    });

    return {
      kind: "imported" as const,
      projectId,
      proposalId: project.proposalId,
      mirrorSpecId,
      sourceVersion: body.sourceVersion,
      specVersionId: createdSpecVersion.id,
      specVersion: createdSpecVersion.version,
      metadataHash: importMetadata.metadataHash,
      metadataStatus: "present" as const,
    };
  }, IMPORT_TRANSACTION_OPTIONS);
}
