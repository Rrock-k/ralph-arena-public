import { prisma } from "@/lib/prisma";
import {
  ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
  parseAcceptedSpecArtifact,
} from "@arena/contracts";

type JsonObject = Record<string, unknown>;

type SpecArtifactAuditProject = {
  id: string;
  name: string;
  tgSpecSourceProjectId: string | null;
  tgSpecMirrorSpecId: string | null;
  tgSpecLastImportedVersion: number | null;
  specs: Array<{
    id: string;
    title: string | null;
    content: string;
    orderIndex: number;
    versions: Array<{
      id: string;
      version: number;
      content: string;
      message: string | null;
      externalSourceProjectId?: string | null;
      externalSourceVersion?: number | null;
      externalSourceUrl?: string | null;
      externalMetadataHash?: string | null;
      acceptedArtifact?: unknown;
    }>;
  }>;
};

export type SpecArtifactAuditClassification =
  | "current_v1_artifact"
  | "markdown_only_spec"
  | "malformed_metadata"
  | "unsafe_metadata"
  | "no_spec";

export type SpecArtifactAudit = {
  projectId: string;
  projectName: string;
  classification: SpecArtifactAuditClassification;
  runnerReady: boolean;
  storageMode:
    | "accepted_artifact_v1"
    | "markdown_only"
    | "none"
    | "invalid";
  latestSpec: {
    specId: string | null;
    specVersionId: string | null;
    version: number | null;
    sourceProjectId: string | null;
    sourceVersion: number | null;
    metadataHash: string | null;
  };
  why: string[];
  allowedActions: string[];
  recommendedNextAction: string;
  operatorNotes: string[];
};

export type FleetSpecArtifactAudit = {
  truth: {
    scannedProjects: number;
    currentV1Artifacts: number;
    markdownOnlySpecs: number;
    malformedMetadata: number;
    unsafeMetadata: number;
    noSpec: number;
    runnerReady: number;
    repairRequired: number;
  };
  classification: {
    status: "all_current_v1_artifacts" | "artifact_repair_required";
    repairCohorts: Array<{
      classification: Exclude<SpecArtifactAuditClassification, "current_v1_artifact">;
      count: number;
    }>;
  };
  why: string[];
  allowedActions: string[];
  recommendedNextAction: string;
  operatorNotes: string[];
  projects: Array<SpecArtifactAudit & {
    archived: boolean;
  }>;
};

export async function getProjectSpecArtifactAudit(projectId: string): Promise<SpecArtifactAudit | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
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
              message: true,
              externalSourceProjectId: true,
              externalSourceVersion: true,
              externalSourceUrl: true,
              externalMetadataHash: true,
              acceptedArtifact: true,
            },
          },
        },
      },
    },
  });

  return project ? buildProjectSpecArtifactAudit(project) : null;
}

export async function getFleetSpecArtifactAudit(options: {
  includeArchived?: boolean;
  limitProjects?: number;
} = {}): Promise<FleetSpecArtifactAudit> {
  const projects = await prisma.project.findMany({
    where: options.includeArchived === false ? { archivedAt: null } : undefined,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
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
              message: true,
              externalSourceProjectId: true,
              externalSourceVersion: true,
              externalSourceUrl: true,
              externalMetadataHash: true,
              acceptedArtifact: true,
            },
          },
        },
      },
    },
  });

  return buildFleetSpecArtifactAudit(projects, {
    limitProjects: options.limitProjects,
  });
}

export function buildProjectSpecArtifactAudit(project: SpecArtifactAuditProject): SpecArtifactAudit {
  const mirrorSpec = project.tgSpecMirrorSpecId
    ? project.specs.find((entry) => entry.id === project.tgSpecMirrorSpecId)
    : null;
  const spec = (mirrorSpec?.versions[0] ? mirrorSpec : null)
    ?? project.specs.find((entry) => entry.versions[0])
    ?? mirrorSpec
    ?? project.specs[0]
    ?? null;
  const version = spec?.versions[0] ?? null;
  const latestSpec = {
    specId: spec?.id ?? null,
    specVersionId: version?.id ?? null,
    version: version?.version ?? null,
    sourceProjectId: version?.externalSourceProjectId ?? project.tgSpecSourceProjectId ?? null,
    sourceVersion: version?.externalSourceVersion ?? project.tgSpecLastImportedVersion ?? null,
    metadataHash: version?.externalMetadataHash ?? null,
  };

  if (!spec || !version) {
    return {
      projectId: project.id,
      projectName: project.name,
      classification: "no_spec",
      runnerReady: false,
      storageMode: "none",
      latestSpec,
      why: ["No accepted spec version is available for artifact materialization."],
      allowedActions: ["reimport_from_tg_spec", "manual_artifact_repair", "park_for_later_repair"],
      recommendedNextAction: "reimport_from_tg_spec",
      operatorNotes: ["Do not invent feedback truth or task projections from loop progress."],
    };
  }

  const acceptedArtifact = version.acceptedArtifact;

  if (isAcceptedArtifactLike(acceptedArtifact)) {
    try {
      const artifact = parseAcceptedSpecArtifact(acceptedArtifact);
      return {
        projectId: project.id,
        projectName: project.name,
        classification: "current_v1_artifact",
        runnerReady: true,
        storageMode: "accepted_artifact_v1",
        latestSpec: {
          ...latestSpec,
          sourceProjectId: artifact.source.sourceProjectId ?? latestSpec.sourceProjectId,
          sourceVersion: artifact.source.sourceVersion ?? latestSpec.sourceVersion,
        },
        why: [
          "Latest spec metadata is a valid v1 AcceptedSpecArtifact.",
          "Runner will forward it as acceptedArtifact through the loop-neutral manifest.",
        ],
        allowedActions: ["no_action", "launch_or_resume"],
        recommendedNextAction: "launch_or_resume",
        operatorNotes: [
          "Do not derive public task projections from Ralph/progress steps.",
        ],
      };
    } catch (error) {
      return invalidAudit(project, latestSpec, error);
    }
  }

  if (acceptedArtifact) {
    return invalidAudit(project, latestSpec, new Error("Latest spec metadata is not a v1 AcceptedSpecArtifact."));
  }

  return {
    projectId: project.id,
    projectName: project.name,
    classification: "markdown_only_spec",
    runnerReady: false,
    storageMode: "markdown_only",
    latestSpec,
    why: ["Latest spec has markdown content but no structured accepted artifact metadata."],
    allowedActions: ["reimport_from_tg_spec", "manual_artifact_repair", "park_for_later_repair"],
    recommendedNextAction: "reimport_from_tg_spec",
    operatorNotes: [
      "Repair or re-import the accepted artifact before launch/resume; do not use markdown-only specs as the current product-truth boundary.",
      "Do not derive public task projections from Ralph/progress steps for markdown-only projects.",
    ],
  };
}

export function buildFleetSpecArtifactAudit(
  projects: Array<SpecArtifactAuditProject & { archivedAt?: Date | string | null }>,
  options: { limitProjects?: number } = {},
): FleetSpecArtifactAudit {
  const audits = projects.map((project) => ({
    ...buildProjectSpecArtifactAudit(project),
    archived: project.archivedAt != null,
  }));
  const repairProjects = audits.filter((audit) => audit.classification !== "current_v1_artifact" || !audit.runnerReady);
  const counts = countByClassification(audits);
  const limitProjects = clampLimit(options.limitProjects ?? 25);
  const projectsForOperator = repairProjects
    .slice()
    .sort(byRepairPriority)
    .slice(0, limitProjects);
  const status: FleetSpecArtifactAudit["classification"]["status"] =
    repairProjects.length === 0 ? "all_current_v1_artifacts" : "artifact_repair_required";
  const repairCohorts = ([
    "unsafe_metadata",
    "malformed_metadata",
    "markdown_only_spec",
    "no_spec",
  ] as const)
    .map((classification) => ({ classification, count: counts[classification] }))
    .filter((entry) => entry.count > 0);

  const unsafeCount = counts.unsafe_metadata;
  const recommendedNextAction = repairProjects.length === 0
    ? "no_action"
    : unsafeCount > 0
      ? "redact_or_remove_metadata_at_source"
      : "reimport_from_tg_spec";

  return {
    truth: {
      scannedProjects: audits.length,
      currentV1Artifacts: counts.current_v1_artifact,
      markdownOnlySpecs: counts.markdown_only_spec,
      malformedMetadata: counts.malformed_metadata,
      unsafeMetadata: counts.unsafe_metadata,
      noSpec: counts.no_spec,
      runnerReady: audits.filter((audit) => audit.runnerReady).length,
      repairRequired: repairProjects.length,
    },
    classification: {
      status,
      repairCohorts,
    },
    why: repairProjects.length === 0
      ? [
          "Every scanned project has a valid v1 AcceptedSpecArtifact.",
          "Spec artifact repair is not blocking current launch/resume decisions.",
        ]
      : [
          `${repairProjects.length} scanned project(s) require explicit spec artifact repair before current spec-driven launch/resume.`,
          unsafeCount > 0
            ? "At least one project has unsafe metadata and must be redacted at the source before re-import."
            : "Repair by re-importing from source truth, manually authoring a valid artifact, or parking the project.",
        ],
    allowedActions: repairProjects.length === 0
      ? ["no_action", "project_spec_artifact_audit"]
      : [
          "project_spec_artifact_audit",
          "reimport_from_tg_spec",
          "manual_artifact_repair",
          "park_for_later_repair",
        ],
    recommendedNextAction,
    operatorNotes: [
      "This is a spec artifact audit, not lifecycle classification.",
      "Do not derive public task projections from Ralph/progress steps for repair-required projects.",
      projectsForOperator.length < repairProjects.length
        ? `Showing ${projectsForOperator.length} of ${repairProjects.length} repair-required project(s).`
        : `Showing ${projectsForOperator.length} repair-required project(s).`,
    ],
    projects: projectsForOperator,
  };
}

function invalidAudit(
  project: SpecArtifactAuditProject,
  latestSpec: SpecArtifactAudit["latestSpec"],
  error: unknown,
): SpecArtifactAudit {
  const message = error instanceof Error ? error.message : String(error);
  const unsafe = isUnsafeArtifactError(message);
  return {
    projectId: project.id,
    projectName: project.name,
    classification: unsafe ? "unsafe_metadata" : "malformed_metadata",
    runnerReady: false,
    storageMode: "invalid",
    latestSpec,
    why: [
      unsafe
        ? "Latest spec metadata contains forbidden or secret-looking artifact content."
        : "Latest spec metadata is present but does not validate against the v1 AcceptedSpecArtifact contract.",
      message,
    ],
    allowedActions: unsafe
      ? ["redact_or_remove_metadata_at_source", "reimport_from_tg_spec", "park_for_later_repair"]
      : ["reimport_from_tg_spec", "manual_artifact_repair", "park_for_later_repair"],
    recommendedNextAction: unsafe ? "redact_or_remove_metadata_at_source" : "reimport_from_tg_spec",
    operatorNotes: ["Do not silently downgrade malformed metadata to markdown extraction."],
  };
}

function isAcceptedArtifactLike(value: unknown): value is JsonObject {
  return isRecord(value) && value.artifactSchemaVersion === ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUnsafeArtifactError(message: string): boolean {
  return /Forbidden accepted spec artifact content|secret-like|secret value|forbidden_field_name/i.test(message);
}

function countByClassification(audits: SpecArtifactAudit[]): Record<SpecArtifactAuditClassification, number> {
  return {
    current_v1_artifact: audits.filter((audit) => audit.classification === "current_v1_artifact").length,
    markdown_only_spec: audits.filter((audit) => audit.classification === "markdown_only_spec").length,
    malformed_metadata: audits.filter((audit) => audit.classification === "malformed_metadata").length,
    unsafe_metadata: audits.filter((audit) => audit.classification === "unsafe_metadata").length,
    no_spec: audits.filter((audit) => audit.classification === "no_spec").length,
  };
}

function byRepairPriority(
  a: SpecArtifactAudit,
  b: SpecArtifactAudit,
): number {
  return repairPriority(a.classification) - repairPriority(b.classification)
    || a.projectName.localeCompare(b.projectName);
}

function repairPriority(classification: SpecArtifactAuditClassification): number {
  switch (classification) {
    case "unsafe_metadata":
      return 0;
    case "malformed_metadata":
      return 1;
    case "markdown_only_spec":
      return 2;
    case "no_spec":
      return 3;
    case "current_v1_artifact":
      return 4;
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}
