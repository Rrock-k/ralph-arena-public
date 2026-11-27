import { createHash } from "crypto";
import type {
  AcceptedSpecArtifact,
} from "@arena/contracts";
import { parseAcceptedSpecArtifact } from "@arena/contracts";

export type TgSpecImportMetadata = {
  acceptedArtifact: AcceptedSpecArtifact;
  metadataHash: string;
  sourceUrl: string | null;
  acceptedAt: Date | null;
  diffItemCount: number;
  diffItemIds: string[];
  workItemCount: number;
  workItemIds: string[];
  reopenedItemIds: string[];
};

export type TgSpecImportRequestForMetadata = {
  packageSchemaVersion?: 1;
  sourceProjectId: string;
  sourceVersion: number;
  specMarkdown: string;
  changeSummary?: string | null;
  sourceUrl?: string | null;
  acceptedArtifact: AcceptedSpecArtifact;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeSourceUrl(bodyUrl?: string | null, artifactUrl?: string | null): string | null {
  const topLevel = typeof bodyUrl === "string" && bodyUrl.trim() ? bodyUrl.trim() : null;
  const fromArtifact = typeof artifactUrl === "string" && artifactUrl.trim() ? artifactUrl.trim() : null;
  if (topLevel && fromArtifact && topLevel !== fromArtifact) {
    throw new Error("sourceUrl conflicts with acceptedArtifact.source.url");
  }
  return topLevel ?? fromArtifact;
}

function assertAcceptedArtifactSourceConsistency(body: TgSpecImportRequestForMetadata): asserts body is TgSpecImportRequestForMetadata & {
  acceptedArtifact: AcceptedSpecArtifact;
} {
  const { acceptedArtifact } = body;
  if (!acceptedArtifact) {
    throw new Error("acceptedArtifact is required");
  }
  if (acceptedArtifact.source.sourceSystem !== "tg-spec") {
    throw new Error("acceptedArtifact.source.sourceSystem must be tg-spec");
  }
  if (acceptedArtifact.source.sourceProjectId !== body.sourceProjectId) {
    throw new Error("acceptedArtifact.source.sourceProjectId does not match sourceProjectId");
  }
  if (acceptedArtifact.source.sourceVersion !== body.sourceVersion) {
    throw new Error("acceptedArtifact.source.sourceVersion does not match sourceVersion");
  }
  if (acceptedArtifact.acceptedDiff.targetSpecVersion !== body.sourceVersion) {
    throw new Error("acceptedArtifact.acceptedDiff.targetSpecVersion does not match sourceVersion");
  }
  if (
    acceptedArtifact.acceptedSpec.renderedMarkdown
    && acceptedArtifact.acceptedSpec.renderedMarkdown.trim() !== body.specMarkdown.trim()
  ) {
    throw new Error("acceptedArtifact.acceptedSpec.renderedMarkdown does not match specMarkdown");
  }
}

function buildMetadataHash(body: TgSpecImportRequestForMetadata, acceptedArtifact: AcceptedSpecArtifact): string {
  const metadataEnvelope = {
    sourceSystem: "tg-spec",
    sourceProjectId: body.sourceProjectId,
    sourceVersion: body.sourceVersion,
    acceptedArtifact,
  };
  return `sha256:${createHash("sha256").update(stableJson(metadataEnvelope)).digest("hex")}`;
}

export function buildTgSpecImportMetadata(body: TgSpecImportRequestForMetadata): TgSpecImportMetadata {
  if (!body.acceptedArtifact) {
    throw new Error("acceptedArtifact is required");
  }
  const acceptedArtifact = parseAcceptedSpecArtifact(body.acceptedArtifact);
  const normalizedBody = { ...body, acceptedArtifact };
  assertAcceptedArtifactSourceConsistency(normalizedBody);
  const sourceUrl = normalizeSourceUrl(body.sourceUrl, acceptedArtifact.source.url);
  const acceptedAt = new Date(acceptedArtifact.acceptedAt);
  const diffItemIds = acceptedArtifact.acceptedDiff.items.map((item) => item.targetId);
  const workItems = acceptedArtifact.acceptedDiff.items.filter((item) => item.workImpact === "requires_loop_work");
  const workItemIds = workItems.map((item) => item.targetId);
  const reopenedItemIds = acceptedArtifact.acceptedDiff.items
    .filter((item) => item.changeType === "reopened")
    .map((item) => item.targetId);

  return {
    acceptedArtifact,
    metadataHash: buildMetadataHash(body, acceptedArtifact),
    sourceUrl,
    acceptedAt,
    diffItemCount: acceptedArtifact.acceptedDiff.items.length,
    diffItemIds,
    workItemCount: workItems.length,
    workItemIds,
    reopenedItemIds,
  };
}
