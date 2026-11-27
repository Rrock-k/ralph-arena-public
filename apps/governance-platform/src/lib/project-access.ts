import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { prisma } from "@/lib/prisma";
import { listRelevantGrantRowsForUser, listScopedGrantRowsForUser } from "@/lib/access-control/server";
import { getAccessGrantLabel, buildEffectiveCapabilityEntries } from "@/lib/access-control/utils";
import type {
  AccessCapability,
  AccessPresetKey,
  EffectiveAccessSource,
} from "@/lib/access-control/types";
import { PROJECT_ACCESS_CAPABILITIES } from "@/lib/access-control/types";
import type { Session } from "next-auth";

type SessionLike = Session | null;

export type ProjectAccessRecord = {
  id: string;
  mode: string;
  visibility?: string | null;
  ownerScopeType: string | null;
  ownerScopeId: string | null;
};

const PROJECT_MANAGE_CAPABILITIES: AccessCapability[] = [
  "project.runtime.manage",
  "project.specs.write",
  "project.assets.manage",
  "project.secrets.manage",
  "project.required_secrets.manage",
  "project.settings.manage",
  "project.delete",
  "project.access.manage",
  "project.budget.manage",
];

export const PROJECT_DASHBOARD_CAPABILITIES: AccessCapability[] = [
  "project.runtime.manage",
  "project.specs.write",
  "project.assets.manage",
  "project.secrets.manage",
  "project.required_secrets.manage",
  "project.settings.manage",
  "project.delete",
];

function ownerSource(projectId: string): EffectiveAccessSource {
  return {
    kind: "owner",
    scope: {
      type: "project",
      projectId,
      label: projectId,
    },
    label: "Project Owner",
    sourcePresetKey: null,
    grantId: null,
    capabilities: [...PROJECT_ACCESS_CAPABILITIES],
    state: "active",
    expiresAt: null,
    revokedAt: null,
  };
}

function bypassSource(): EffectiveAccessSource {
  return {
    kind: "direct",
    scope: { type: "platform", label: "Platform" },
    label: "E2E bypass",
    sourcePresetKey: "superadmin",
    grantId: null,
    capabilities: [...PROJECT_ACCESS_CAPABILITIES],
    state: "active",
    expiresAt: null,
    revokedAt: null,
  };
}

function grantSource(
  row: Awaited<ReturnType<typeof listRelevantGrantRowsForUser>>[number],
): EffectiveAccessSource {
  const sourcePresetKey = row.sourcePresetKey as AccessPresetKey | null;
  const label = getAccessGrantLabel({
    customLabel: row.customLabel,
    sourcePresetKey,
    capabilities: row.capabilities as AccessCapability[],
  });
  const scope =
    row.scopeType === "project" && row.scopeId
      ? {
        type: "project" as const,
        projectId: row.scopeId,
        projectName: row.scopeId,
        label: row.scopeId,
      }
      : {
        type: "platform" as const,
        label: "Platform",
      };

  return {
    kind: row.scopeType === "project" ? "direct" : "inherited",
    scope,
    label: row.scopeType === "project" ? label : `via ${label}`,
    sourcePresetKey,
    grantId: row.id,
    capabilities: row.capabilities as AccessCapability[],
    state: "active",
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function hasCapability(
  capabilities: AccessCapability[],
  required: AccessCapability,
): boolean {
  return capabilities.includes(required);
}

function hasAnyCapability(
  capabilities: AccessCapability[],
  required: AccessCapability[],
): boolean {
  return required.some((capability) => capabilities.includes(capability));
}

export async function resolveProjectAccess(
  project: ProjectAccessRecord | null | undefined,
  session: SessionLike,
  hasBypass = false,
) {
  const isOwner =
    !!session?.user?.id &&
    !!project &&
    project.ownerScopeType === "user" &&
    project.ownerScopeId === session.user.id;
  const isPersonalOwner = !!project && project.mode === "personal" && isOwner;

  const grantSources = !hasBypass && project && session?.user?.id
    ? (await listRelevantGrantRowsForUser(session.user.id, project.id)).map((row) => grantSource(row))
    : [];

  const activeSources: EffectiveAccessSource[] = [
    ...(hasBypass ? [bypassSource()] : []),
    ...(project && isOwner ? [ownerSource(project.id)] : []),
    ...grantSources,
  ];

  const effectiveCapabilityEntries = buildEffectiveCapabilityEntries(activeSources);
  const effectiveCapabilities = effectiveCapabilityEntries.map((entry) => entry.capability);
  const hasAnyProjectCapability = effectiveCapabilities.some((capability) => capability.startsWith("project."));
  const canAccessPrivate = hasBypass || isOwner || hasAnyProjectCapability;
  const visibility = project?.visibility ?? "public";
  const isAuthenticated = !!session?.user || !!hasBypass;
  const canView =
    !!project &&
    (
      visibility === "featured" ||
      (visibility === "public" && isAuthenticated) ||
      (visibility === "private" && canAccessPrivate)
    );

  return {
    isAdmin: hasBypass,
    isOwner,
    isPersonalOwner,
    canAccessPrivate,
    canManage: hasBypass || isOwner || hasAnyCapability(effectiveCapabilities, PROJECT_MANAGE_CAPABILITIES),
    canView,
    sources: activeSources,
    effectiveCapabilities,
    effectiveCapabilityEntries,
    hasCapability: (required: AccessCapability) => hasCapability(effectiveCapabilities, required),
    hasAnyCapability: (required: AccessCapability[]) => hasAnyCapability(effectiveCapabilities, required),
  };
}

export async function resolveProjectAccessMap(
  projects: ProjectAccessRecord[],
  session: SessionLike,
  hasBypass = false,
) {
  if (projects.length === 0) {
    return {} as Record<string, Awaited<ReturnType<typeof resolveProjectAccess>>>;
  }

  const uniqueProjects = [...new Map(projects.map((project) => [project.id, project])).values()];
  const projectIds = uniqueProjects.map((project) => project.id);
  const grantRows = !hasBypass && session?.user?.id
    ? await listScopedGrantRowsForUser(session.user.id, projectIds)
    : [];

  const platformGrantRows = grantRows.filter((row) => row.scopeType === "platform");
  const projectGrantRowsByProjectId = new Map<string, typeof grantRows>();
  for (const row of grantRows) {
    if (row.scopeType !== "project" || !row.scopeId) {
      continue;
    }
    const rows = projectGrantRowsByProjectId.get(row.scopeId) ?? [];
    rows.push(row);
    projectGrantRowsByProjectId.set(row.scopeId, rows);
  }

  return Object.fromEntries(uniqueProjects.map((project) => {
    const isOwner =
      !!session?.user?.id &&
      project.ownerScopeType === "user" &&
      project.ownerScopeId === session.user.id;
    const isPersonalOwner = project.mode === "personal" && isOwner;
    const scopedGrantSources = [
      ...platformGrantRows.map((row) => grantSource(row)),
      ...(projectGrantRowsByProjectId.get(project.id) ?? []).map((row) => grantSource(row)),
    ];
    const activeSources: EffectiveAccessSource[] = [
      ...(hasBypass ? [bypassSource()] : []),
      ...(isOwner ? [ownerSource(project.id)] : []),
      ...scopedGrantSources,
    ];
    const effectiveCapabilityEntries = buildEffectiveCapabilityEntries(activeSources);
    const effectiveCapabilities = effectiveCapabilityEntries.map((entry) => entry.capability);
    const hasAnyProjectCapability = effectiveCapabilities.some((capability) => capability.startsWith("project."));
    const canAccessPrivate = hasBypass || isOwner || hasAnyProjectCapability;
    const visibility = project.visibility ?? "public";
    const isAuthenticated = !!session?.user || !!hasBypass;
    const canView =
      visibility === "featured"
      || (visibility === "public" && isAuthenticated)
      || (visibility === "private" && canAccessPrivate);

    return [project.id, {
      isAdmin: hasBypass,
      isOwner,
      isPersonalOwner,
      canAccessPrivate,
      canManage: hasBypass || isOwner || hasAnyCapability(effectiveCapabilities, PROJECT_MANAGE_CAPABILITIES),
      canView,
      sources: activeSources,
      effectiveCapabilities,
      effectiveCapabilityEntries,
      hasCapability: (required: AccessCapability) => hasCapability(effectiveCapabilities, required),
      hasAnyCapability: (required: AccessCapability[]) => hasAnyCapability(effectiveCapabilities, required),
    }];
  })) as Record<string, Awaited<ReturnType<typeof resolveProjectAccess>>>;
}

async function requireProjectAccessBase(projectId: string) {
  const [session, hasBypass, project] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        mode: true,
        visibility: true,
        ownerScopeType: true,
        ownerScopeId: true,
      },
    }),
  ]);

  const access = await resolveProjectAccess(project, session, hasBypass);

  if (!session?.user && !hasBypass) {
    return {
      authorized: false as const,
      error: "Unauthorized",
      session,
      hasBypass,
      project,
      ...access,
    };
  }

  if (!project) {
    return {
      authorized: false as const,
      error: "Project not found",
      session,
      hasBypass,
      project,
      ...access,
    };
  }

  return {
    authorized: true as const,
    session,
    hasBypass,
    project,
    ...access,
  };
}

export async function requireProjectCapability(
  projectId: string,
  capability: AccessCapability,
) {
  const base = await requireProjectAccessBase(projectId);
  if (!base.authorized) {
    return base;
  }

  if (!base.hasCapability(capability)) {
    return {
      ...base,
      authorized: false as const,
      error: "Project access denied",
    };
  }

  return base;
}

export async function requireAnyProjectCapability(
  projectId: string,
  capabilities: AccessCapability[],
) {
  const base = await requireProjectAccessBase(projectId);
  if (!base.authorized) {
    return base;
  }

  if (!base.hasAnyCapability(capabilities)) {
    return {
      ...base,
      authorized: false as const,
      error: "Project access denied",
    };
  }

  return base;
}

export async function requireProjectManageAccess(projectId: string) {
  return requireAnyProjectCapability(projectId, PROJECT_MANAGE_CAPABILITIES);
}
