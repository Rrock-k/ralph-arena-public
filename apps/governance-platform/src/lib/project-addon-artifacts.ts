import type { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import {
  parseAcceptedSpecArtifact,
  type AcceptedSpecArtifact,
  type SecretRequirementRef,
} from "@arena/contracts";
import type { ProjectAddonDefinition } from "@/lib/project-addons";
import {
  isValidRequiredSecretKey,
  normalizeRequiredSecretKey,
} from "@/lib/required-secrets";

const ADDON_ARTIFACT_SOURCE_VERSION = 1;

type BuildProjectAddonAcceptedArtifactOptions = {
  acceptedAt?: Date;
};

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function addonIdPart(addon: ProjectAddonDefinition): string {
  return addon.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function secretRequirementRefs(addon: ProjectAddonDefinition, sourceRefId: string): SecretRequirementRef[] {
  const idPart = addonIdPart(addon);

  return addon.requiredSecrets.map((secret) => {
    const key = normalizeRequiredSecretKey(secret.key);
    if (!key || !isValidRequiredSecretKey(key)) {
      throw new Error(`Invalid add-on required secret key: ${secret.key}`);
    }

    return {
      id: `SECRET-ARENA-ADDON-${idPart}-${key}`,
      key,
      description: secret.description?.trim() || undefined,
      required: true,
      blocking: secret.blocking !== false,
      sourceRefs: [sourceRefId],
    };
  });
}

export function buildProjectAddonAcceptedArtifact(
  addon: ProjectAddonDefinition,
  options: BuildProjectAddonAcceptedArtifactOptions = {},
): AcceptedSpecArtifact {
  const acceptedAt = options.acceptedAt ?? new Date();
  const idPart = addonIdPart(addon);
  const sourceRefId = `SRC-ARENA-ADDON-${idPart}`;
  const specId = `SPEC-ARENA-ADDON-${idPart}`;
  const requirementId = `REQ-ARENA-ADDON-${idPart}`;
  const diffId = `DIFF-ARENA-ADDON-${idPart}`;
  const secretRequirements = secretRequirementRefs(addon, sourceRefId);
  const secretKeys = secretRequirements.map((secret) => secret.key).join(", ");
  const secretSummary = secretKeys ? ` and use required secret key(s): ${secretKeys}` : "";
  const summary = `Project add-on selected: ${addon.label}. Implement the add-on requirements${secretSummary}.`;

  return parseAcceptedSpecArtifact({
    artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1",
    artifactId: `SPEC-ARTIFACT-ARENA-ADDON-${idPart}`,
    acceptedAt: acceptedAt.toISOString(),
    source: {
      id: sourceRefId,
      sourceSystem: "arena",
      sourceVersion: ADDON_ARTIFACT_SOURCE_VERSION,
      sourceRefType: "operator_note",
      sourceId: `project-addon:${addon.id}`,
    },
    acceptedSpec: {
      id: specId,
      version: ADDON_ARTIFACT_SOURCE_VERSION,
      document: {
        specSchemaVersion: "ra-287.spec-document.v1",
        title: addon.specTitle,
        sections: [
          {
            id: `SPEC-SECTION-ARENA-ADDON-${idPart}`,
            title: addon.specTitle,
            body: addon.specContent,
            requirementIds: [requirementId],
            sourceRefs: [sourceRefId],
          },
        ],
        requirements: [
          {
            id: requirementId,
            kind: "integration",
            title: addon.label,
            statement: addon.specContent,
            priority: "high",
            acceptanceCriteria: [
              "The app implements the add-on behavior described in the add-on spec.",
              "Required secret values are consumed only through platform-owned runtime secret injection.",
              "External API request construction is covered by mocked or contract verification when live verification is outside the autonomous boundary.",
            ],
            sourceRefs: [sourceRefId],
          },
        ],
        extensionBlocks: [],
      },
      renderedMarkdown: addon.specContent,
      contentHash: sha256(addon.specContent),
      sourceRefs: [sourceRefId],
    },
    acceptedDiff: {
      id: diffId,
      targetSpecVersion: ADDON_ARTIFACT_SOURCE_VERSION,
      summary,
      items: [
        {
          id: `${diffId}-SPEC`,
          targetType: "spec",
          targetId: specId,
          changeType: "created",
          workImpact: "requires_loop_work",
          summary,
          sourceRefs: [sourceRefId],
        },
      ],
    },
    feedback: [],
    assumptions: [],
    secretRequirements,
    assets: [],
  });
}

export function buildProjectAddonArtifactMetadataHash(artifact: AcceptedSpecArtifact): `sha256:${string}` {
  return sha256(JSON.stringify(artifact));
}

export function buildProjectAddonSpecVersionCreate(
  addon: ProjectAddonDefinition,
  options: BuildProjectAddonAcceptedArtifactOptions = {},
): Prisma.SpecVersionCreateWithoutSpecInput {
  const acceptedAt = options.acceptedAt ?? new Date();
  const acceptedArtifact = buildProjectAddonAcceptedArtifact(addon, { acceptedAt });

  return {
    version: ADDON_ARTIFACT_SOURCE_VERSION,
    content: addon.specContent,
    message: `Project add-on: ${addon.label}`,
    externalSourceSystem: "arena",
    externalSourceVersion: ADDON_ARTIFACT_SOURCE_VERSION,
    externalAcceptedAt: acceptedAt,
    externalMetadataHash: buildProjectAddonArtifactMetadataHash(acceptedArtifact),
    acceptedArtifact: acceptedArtifact as unknown as Prisma.InputJsonValue,
  };
}
