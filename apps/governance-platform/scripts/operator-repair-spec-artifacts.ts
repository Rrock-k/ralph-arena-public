import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
  SPEC_DOCUMENT_SCHEMA_VERSION,
  parseAcceptedSpecArtifact,
  type AcceptedSpecArtifact,
} from "@arena/contracts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});
const CHUNK_SIZE = 7_600;
const MAX_EXTENSION_BLOCKS = 100;

type Args = {
  apply: boolean;
  includeArchived: boolean;
  json: boolean;
  limit: number | null;
  projectIds: string[];
};

type RepairOutcome = {
  projectId: string;
  projectName: string;
  specVersionId: string | null;
  classification: "current_v1_artifact" | "markdown_only_spec" | "no_spec" | "invalid_metadata";
  action: "noop" | "would_repair" | "repaired" | "skipped";
  reason: string;
  metadataHash?: string;
  artifactId?: string;
};

type ArtifactSourceSystem = "tg-spec" | "arena" | "loop" | "operator" | "production";
type ArtifactSourceRefType = "accepted_spec" | "discussion_message" | "loop_output" | "operator_note" | "production_evidence";

type SpecVersionForRepair = {
  id: string;
  version: number;
  content: string | null;
  acceptedArtifact: Prisma.JsonValue | null;
  externalSourceSystem: string | null;
  externalSourceProjectId: string | null;
  externalSourceVersion: number | null;
};

type SpecForRepair = {
  id: string;
  title: string | null;
  content: string | null;
  versions: SpecVersionForRepair[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    includeArchived: false,
    json: false,
    limit: null,
    projectIds: [],
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--include-archived") {
      args.includeArchived = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit must be a positive integer");
      args.limit = value;
    } else if (arg.startsWith("--project=")) {
      const value = arg.slice("--project=".length).trim();
      if (value) args.projectIds.push(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashRef(value: string): `sha256:${string}` {
  return `sha256:${sha256(value)}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function title(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || fallback).replace(/\s+/g, " ").trim();
  return normalized.slice(0, 200) || fallback;
}

function summary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 1_000);
}

function chunks(markdown: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < markdown.length; index += CHUNK_SIZE) {
    result.push(markdown.slice(index, index + CHUNK_SIZE));
  }
  return result;
}

function metadataHash(projectId: string, specVersionId: string, artifact: AcceptedSpecArtifact): string {
  return hashRef(stableJson({
    sourceSystem: "operator",
    projectId,
    specVersionId,
    acceptedArtifact: artifact,
  }));
}

function selectSpec(project: {
  tgSpecMirrorSpecId: string | null;
  specs: SpecForRepair[];
}): SpecForRepair | null {
  const mirrorSpec = project.tgSpecMirrorSpecId
    ? project.specs.find((entry) => entry.id === project.tgSpecMirrorSpecId)
    : null;
  return (mirrorSpec?.versions[0] ? mirrorSpec : null)
    ?? project.specs.find((entry) => entry.versions[0])
    ?? mirrorSpec
    ?? project.specs[0]
    ?? null;
}

function acceptedMarkdown(version: SpecVersionForRepair, spec: SpecForRepair): string | null {
  return version.content || spec.content || null;
}

function normalizeSourceSystem(value: string | null | undefined): ArtifactSourceSystem {
  if (
    value === "tg-spec"
    || value === "arena"
    || value === "loop"
    || value === "operator"
    || value === "production"
  ) {
    return value;
  }
  return "operator";
}

function resolveArtifactSource(input: {
  projectId: string;
  specVersionId: string;
  specVersion: number;
  externalSourceSystem: string | null;
  externalSourceProjectId: string | null;
  externalSourceVersion: number | null;
  tgSpecSourceProjectId: string | null;
  tgSpecLastImportedVersion: number | null;
}) {
  const hasTgSpecSource = Boolean(input.tgSpecSourceProjectId && input.tgSpecLastImportedVersion);
  const sourceSystem = hasTgSpecSource
    ? "tg-spec"
    : normalizeSourceSystem(input.externalSourceSystem);
  const sourceProjectId = sourceSystem === "tg-spec"
    ? input.tgSpecSourceProjectId!
    : input.externalSourceProjectId ?? input.projectId;
  const sourceVersion = sourceSystem === "tg-spec"
    ? input.tgSpecLastImportedVersion!
    : input.externalSourceVersion ?? input.specVersion;

  return {
    sourceSystem,
    sourceProjectId,
    sourceVersion,
    sourceRefType: (sourceSystem === "tg-spec" ? "accepted_spec" : "operator_note") satisfies ArtifactSourceRefType,
    sourceId: sourceSystem === "tg-spec"
      ? `${sourceProjectId}:v${sourceVersion}`
      : `specVersion:${input.specVersionId}`,
  } as const;
}

function shouldRefreshOperatorRepairArtifact(
  artifact: AcceptedSpecArtifact,
  artifactSource: ReturnType<typeof resolveArtifactSource>,
): boolean {
  return artifact.artifactId.startsWith("OPREPAIR:")
    && artifact.source.sourceSystem === "operator"
    && artifactSource.sourceSystem === "tg-spec";
}

function stripRetiredTaskFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;

  const artifact = structuredClone(value) as Record<string, unknown>;
  delete artifact.tasks;

  const acceptedDiff = artifact.acceptedDiff;
  if (acceptedDiff && typeof acceptedDiff === "object" && !Array.isArray(acceptedDiff)) {
    const diff = acceptedDiff as Record<string, unknown>;
    if (Array.isArray(diff.items)) {
      diff.items = diff.items.filter((item) => (
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>).targetType !== "task"
          : true
      ));
    }
  }

  for (const key of ["feedback", "assumptions", "secretRequirements", "assets"]) {
    const entries = artifact[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        delete (entry as Record<string, unknown>).relatedTaskIds;
      }
    }
  }

  return artifact;
}

function buildOperatorArtifact(input: {
  projectId: string;
  projectName: string;
  sourceSystem: ArtifactSourceSystem;
  sourceProjectId: string;
  sourceVersion: number;
  sourceRefType: ArtifactSourceRefType;
  sourceId: string;
  specTitle: string | null;
  specVersionId: string;
  specVersion: number;
  markdown: string;
  acceptedAt: string;
}): AcceptedSpecArtifact {
  if (input.markdown.length > 1_000_000) {
    throw new Error("Spec markdown exceeds accepted artifact renderedMarkdown limit");
  }

  const markdownChunks = chunks(input.markdown);
  if (markdownChunks.length > MAX_EXTENSION_BLOCKS) {
    throw new Error("Spec markdown exceeds extensionBlocks materialization limit");
  }

  const shortHash = sha256(`${input.projectId}:${input.specVersionId}:${input.markdown}`).slice(0, 16).toUpperCase();
  const sourceRefId = `SRC:${shortHash}`;
  const acceptedSpecId = `SPEC:${shortHash}`;
  const diffId = `DIFF:${shortHash}`;
  const diffItemId = `DIFFITEM:${shortHash}`;
  const contentHash = hashRef(input.markdown);
  const projectTitle = title(input.specTitle, input.projectName || "Accepted Spec");
  const repairReason = "Operator repair materialized pre-existing accepted markdown because the stored SpecVersion predated RA-287 structured artifacts.";

  const artifact: AcceptedSpecArtifact = {
    artifactSchemaVersion: ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
    artifactId: `OPREPAIR:${shortHash}`,
    acceptedAt: input.acceptedAt,
    source: {
      id: sourceRefId,
      sourceSystem: input.sourceSystem,
      sourceProjectId: input.sourceProjectId,
      sourceVersion: input.sourceVersion,
      sourceRefType: input.sourceRefType,
      sourceId: input.sourceId,
      fingerprint: contentHash,
    },
    acceptedSpec: {
      id: acceptedSpecId,
      version: input.specVersion,
      document: {
        specSchemaVersion: SPEC_DOCUMENT_SCHEMA_VERSION,
        title: projectTitle,
        summary: summary("Operator materialized the existing accepted markdown into the strict v1 accepted spec artifact without adding feedback, assumptions, secrets or assets."),
        sections: [],
        requirements: [],
        extensionBlocks: markdownChunks.map((chunk, index) => ({
          id: `EXT:${shortHash}:${index + 1}`,
          title: title(`Accepted Markdown ${index + 1}`, "Accepted Markdown"),
          body: chunk,
          reason: repairReason,
          sourceRefs: [sourceRefId],
        })),
      },
      renderedMarkdown: input.markdown,
      contentHash,
      sourceRefs: [sourceRefId],
    },
    acceptedDiff: {
      id: diffId,
      targetSpecVersion: input.specVersion,
      summary: summary("No product change: operator materialized existing accepted markdown into v1 AcceptedSpecArtifact for current runner handoff."),
      items: [{
        id: diffItemId,
        targetType: "spec",
        targetId: acceptedSpecId,
        changeType: "accepted",
        workImpact: "no_loop_work",
        summary: summary("Metadata-only repair; existing accepted markdown is unchanged."),
        sourceRefs: [sourceRefId],
      }],
    },
    feedback: [],
    assumptions: [],
    secretRequirements: [],
    assets: [],
  };

  return parseAcceptedSpecArtifact(artifact);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const acceptedAt = new Date().toISOString();

  const projects = await prisma.project.findMany({
    where: {
      ...(args.includeArchived ? {} : { archivedAt: null }),
      ...(args.projectIds.length > 0 ? { id: { in: args.projectIds } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: args.limit ?? undefined,
    select: {
      id: true,
      name: true,
      archivedAt: true,
      tgSpecSourceProjectId: true,
      tgSpecMirrorSpecId: true,
      tgSpecLastImportedVersion: true,
      specs: {
        orderBy: { orderIndex: "asc" },
        select: {
          id: true,
          title: true,
          content: true,
          orderIndex: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              version: true,
              content: true,
              acceptedArtifact: true,
              externalSourceSystem: true,
              externalSourceProjectId: true,
              externalSourceVersion: true,
            },
          },
        },
      },
    },
  });

  const outcomes: RepairOutcome[] = [];

  for (const project of projects) {
    const spec = selectSpec(project);
    const version = spec?.versions[0] ?? null;

    if (!spec || !version) {
      outcomes.push({
        projectId: project.id,
        projectName: project.name,
        specVersionId: null,
        classification: "no_spec",
        action: "skipped",
        reason: "No accepted SpecVersion exists; operator must re-import from source truth or park explicitly.",
      });
      continue;
    }

    const artifactSource = resolveArtifactSource({
      projectId: project.id,
      specVersionId: version.id,
      specVersion: version.version,
      externalSourceSystem: version.externalSourceSystem,
      externalSourceProjectId: version.externalSourceProjectId,
      externalSourceVersion: version.externalSourceVersion,
      tgSpecSourceProjectId: project.tgSpecSourceProjectId,
      tgSpecLastImportedVersion: project.tgSpecLastImportedVersion,
    });

    if (version.acceptedArtifact) {
      try {
        let parsedArtifact: AcceptedSpecArtifact;
        let normalizedArtifact: AcceptedSpecArtifact | null = null;
        try {
          parsedArtifact = parseAcceptedSpecArtifact(version.acceptedArtifact);
        } catch (error) {
          const strippedArtifact = stripRetiredTaskFields(version.acceptedArtifact);
          normalizedArtifact = parseAcceptedSpecArtifact(strippedArtifact);
          parsedArtifact = normalizedArtifact;
        }
        if (!shouldRefreshOperatorRepairArtifact(parsedArtifact, artifactSource)) {
          if (normalizedArtifact) {
            const hash = metadataHash(project.id, version.id, normalizedArtifact);
            if (args.apply) {
              await prisma.specVersion.update({
                where: { id: version.id },
                data: {
                  acceptedArtifact: normalizedArtifact as unknown as Prisma.InputJsonValue,
                  externalMetadataHash: hash,
                  externalAcceptedAt: new Date(normalizedArtifact.acceptedAt),
                  externalSourceSystem: artifactSource.sourceSystem,
                  externalSourceProjectId: artifactSource.sourceProjectId,
                  externalSourceVersion: artifactSource.sourceVersion,
                },
              });
            }
            outcomes.push({
              projectId: project.id,
              projectName: project.name,
              specVersionId: version.id,
              classification: "current_v1_artifact",
              action: args.apply ? "repaired" : "would_repair",
              reason: "Normalize existing artifact by removing retired task fields from the accepted spec artifact contract.",
              metadataHash: hash,
              artifactId: normalizedArtifact.artifactId,
            });
            continue;
          }
          outcomes.push({
            projectId: project.id,
            projectName: project.name,
            specVersionId: version.id,
            classification: "current_v1_artifact",
            action: "noop",
            reason: "Latest SpecVersion already has a valid v1 AcceptedSpecArtifact.",
          });
          continue;
        }

        const markdown = acceptedMarkdown(version, spec);
        if (!markdown) {
          outcomes.push({
            projectId: project.id,
            projectName: project.name,
            specVersionId: version.id,
            classification: "invalid_metadata",
            action: "skipped",
            reason: "SpecVersion has no accepted markdown to materialize.",
          });
          continue;
        }

        const refreshedArtifact = buildOperatorArtifact({
          projectId: project.id,
          projectName: project.name,
          ...artifactSource,
          specTitle: spec.title,
          specVersionId: version.id,
          specVersion: version.version,
          markdown,
          acceptedAt,
        });
        const hash = metadataHash(project.id, version.id, refreshedArtifact);
        if (args.apply) {
          await prisma.specVersion.update({
            where: { id: version.id },
            data: {
              acceptedArtifact: refreshedArtifact as unknown as Prisma.InputJsonValue,
              externalMetadataHash: hash,
              externalAcceptedAt: new Date(refreshedArtifact.acceptedAt),
              externalSourceSystem: artifactSource.sourceSystem,
              externalSourceProjectId: artifactSource.sourceProjectId,
              externalSourceVersion: artifactSource.sourceVersion,
            },
          });
        }
        outcomes.push({
          projectId: project.id,
          projectName: project.name,
          specVersionId: version.id,
          classification: "current_v1_artifact",
          action: args.apply ? "repaired" : "would_repair",
          reason: "Refresh operator materialization provenance to the existing tg-spec source binding.",
          metadataHash: hash,
          artifactId: refreshedArtifact.artifactId,
        });
      } catch (error) {
        outcomes.push({
          projectId: project.id,
          projectName: project.name,
          specVersionId: version.id,
          classification: "invalid_metadata",
          action: "skipped",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    let artifact: AcceptedSpecArtifact;
    try {
      const markdown = acceptedMarkdown(version, spec);
      if (!markdown) {
        outcomes.push({
          projectId: project.id,
          projectName: project.name,
          specVersionId: version.id,
          classification: "markdown_only_spec",
          action: "skipped",
          reason: "SpecVersion has no accepted markdown to materialize.",
        });
        continue;
      }

      artifact = buildOperatorArtifact({
        projectId: project.id,
        projectName: project.name,
        ...artifactSource,
        specTitle: spec.title,
        specVersionId: version.id,
        specVersion: version.version,
        markdown,
        acceptedAt,
      });
    } catch (error) {
      outcomes.push({
        projectId: project.id,
        projectName: project.name,
        specVersionId: version.id,
        classification: "markdown_only_spec",
        action: "skipped",
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const hash = metadataHash(project.id, version.id, artifact);
    if (args.apply) {
      await prisma.specVersion.update({
        where: { id: version.id },
        data: {
          acceptedArtifact: artifact as unknown as Prisma.InputJsonValue,
          externalMetadataHash: hash,
          externalAcceptedAt: new Date(artifact.acceptedAt),
          externalSourceSystem: version.externalSourceSystem ?? artifactSource.sourceSystem,
          externalSourceProjectId: version.externalSourceProjectId ?? artifactSource.sourceProjectId,
          externalSourceVersion: version.externalSourceVersion ?? artifactSource.sourceVersion,
        },
      });
    }

    outcomes.push({
      projectId: project.id,
      projectName: project.name,
      specVersionId: version.id,
      classification: "markdown_only_spec",
      action: args.apply ? "repaired" : "would_repair",
      reason: "Materialize existing accepted markdown into v1 AcceptedSpecArtifact without adding feedback, assumptions, secrets or assets.",
      metadataHash: hash,
      artifactId: artifact.artifactId,
    });
  }

  const summaryResult = {
    mode: args.apply ? "apply" : "dry_run",
    scanned: outcomes.length,
    repaired: outcomes.filter((entry) => entry.action === "repaired").length,
    wouldRepair: outcomes.filter((entry) => entry.action === "would_repair").length,
    skipped: outcomes.filter((entry) => entry.action === "skipped").length,
    noop: outcomes.filter((entry) => entry.action === "noop").length,
    byClassification: outcomes.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.classification] = (acc[entry.classification] ?? 0) + 1;
      return acc;
    }, {}),
    outcomes,
  };

  if (args.json) {
    console.log(JSON.stringify(summaryResult, null, 2));
  } else {
    console.log(`mode: ${summaryResult.mode}`);
    console.log(`scanned: ${summaryResult.scanned}`);
    console.log(`repaired: ${summaryResult.repaired}`);
    console.log(`wouldRepair: ${summaryResult.wouldRepair}`);
    console.log(`skipped: ${summaryResult.skipped}`);
    console.log(`noop: ${summaryResult.noop}`);
    console.log(`byClassification: ${JSON.stringify(summaryResult.byClassification)}`);
    for (const outcome of outcomes) {
      console.log(`${outcome.action}\t${outcome.classification}\t${outcome.projectId}\t${outcome.projectName}\t${outcome.reason}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
