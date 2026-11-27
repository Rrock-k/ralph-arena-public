import { prisma } from "@/lib/prisma";
import { getProjectName } from "@/lib/project-identity";
import { ACCESS_PRESET_DEFINITIONS } from "./presets";
import { PROJECT_ACCESS_CAPABILITIES, TG_SPEC_AUTO_SYNC_REASON_PREFIX } from "./types";
import type {
  AccessActorSummary,
  AccessAdminData,
  AccessAuditEntry,
  AccessCapability,
  AccessGrantRecord,
  AccessGrantSourceKind,
  AccessProjectOption,
  AccessScopeRef,
  AccessSubjectSummary,
  EffectiveAccessSource,
  ProjectAccessCapability,
  ProjectAccessPanelState,
} from "./types";
import {
  buildEffectiveCapabilityEntries,
  getAccessGrantLabel,
  getAccessGrantVisualState,
} from "./utils";

type AccessUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: string;
};

type AccessActorRow = {
  id: string;
  email: string | null;
  name: string | null;
};

export type AccessGrantRow = {
  id: string;
  subjectUserId: string;
  scopeType: string;
  scopeId: string | null;
  sourcePresetKey: string | null;
  sourceKind: string;
  sourceSyncedAt: Date | null;
  customLabel: string | null;
  capabilities: string[];
  grantedById: string | null;
  reason: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subjectUser: AccessUserRow;
  grantedBy: AccessActorRow | null;
};

type AccessAuditRow = {
  id: string;
  action: string;
  actorUserId: string | null;
  subjectUserId: string;
  scopeType: string;
  scopeId: string | null;
  sourcePresetKey: string | null;
  sourceKind: string;
  previousCapabilities: string[];
  nextCapabilities: string[];
  note: string | null;
  createdAt: Date;
  actorUser: AccessActorRow | null;
  subjectUser: AccessUserRow;
};

type AccessGrantDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<AccessGrantRow[]>;
};

type AccessAuditLogDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<AccessAuditRow[]>;
};

function getAccessGrantDelegate(): AccessGrantDelegate {
  const delegate = (prisma as unknown as { accessGrant?: AccessGrantDelegate }).accessGrant;
  if (!delegate) {
    throw new Error("Prisma accessGrant delegate is unavailable. Regenerate Prisma client before using RA-223 access control.");
  }
  return delegate;
}

function getAccessAuditLogDelegate(): AccessAuditLogDelegate {
  const delegate = (prisma as unknown as { accessAuditLog?: AccessAuditLogDelegate }).accessAuditLog;
  if (!delegate) {
    throw new Error("Prisma accessAuditLog delegate is unavailable. Regenerate Prisma client before using RA-223 access control.");
  }
  return delegate;
}

const ACTIVE_PROJECT_DASHBOARD_CAPABILITIES: AccessCapability[] = [
  "project.runtime.manage",
  "project.specs.write",
  "project.assets.manage",
  "project.secrets.manage",
  "project.required_secrets.manage",
  "project.settings.manage",
  "project.delete",
];

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toActorSummary(actor: AccessActorRow | null): AccessActorSummary | null {
  if (!actor) return null;
  return {
    id: actor.id,
    email: actor.email,
    name: actor.name,
  };
}

function toSubjectSummary(user: AccessUserRow): AccessSubjectSummary {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    imageUrl: user.image,
  };
}

function buildScopeRef(
  scopeType: string,
  scopeId: string | null,
  projectNames: Map<string, string>,
): AccessScopeRef {
  if (scopeType === "project" && scopeId) {
    const projectName = projectNames.get(scopeId) ?? scopeId;
    return {
      type: "project",
      projectId: scopeId,
      projectName,
      label: projectName,
    };
  }

  return {
    type: "platform",
    label: "Platform",
  };
}

function getProjectCapabilities(capabilities: string[]): AccessCapability[] {
  const projectCapabilitySet = new Set<string>(PROJECT_ACCESS_CAPABILITIES);
  return capabilities.filter((capability): capability is ProjectAccessCapability =>
    projectCapabilitySet.has(capability),
  );
}

function normalizeGrantSourceKind(sourceKind: string, reason?: string | null): AccessGrantSourceKind {
  if (sourceKind === "telegram_admin_sync" || reason?.startsWith(TG_SPEC_AUTO_SYNC_REASON_PREFIX) === true) {
    return "telegram_admin_sync";
  }
  return "manual";
}

function toGrantRecord(
  row: AccessGrantRow,
  projectNames: Map<string, string>,
): AccessGrantRecord {
  const scope = buildScopeRef(row.scopeType, row.scopeId, projectNames);
  const sourceKind = normalizeGrantSourceKind(row.sourceKind, row.reason);

  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    subject: toSubjectSummary(row.subjectUser),
    scope,
    sourcePresetKey: row.sourcePresetKey as AccessGrantRecord["sourcePresetKey"],
    sourceKind,
    customLabel: row.customLabel,
    capabilities: row.capabilities as AccessCapability[],
    grantedBy: toActorSummary(row.grantedBy),
    reason: row.reason,
    lastSyncedAt: sourceKind === "telegram_admin_sync" ? toIso(row.sourceSyncedAt) : null,
    expiresAt: toIso(row.expiresAt),
    revokedAt: toIso(row.revokedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAuditEntry(
  row: AccessAuditRow,
  projectNames: Map<string, string>,
): AccessAuditEntry {
  return {
    id: row.id,
    action: row.action as AccessAuditEntry["action"],
    occurredAt: row.createdAt.toISOString(),
    actor: toActorSummary(row.actorUser),
    subject: toSubjectSummary(row.subjectUser),
    scope: buildScopeRef(row.scopeType, row.scopeId, projectNames),
    sourcePresetKey: row.sourcePresetKey as AccessAuditEntry["sourcePresetKey"],
    sourceKind: normalizeGrantSourceKind(row.sourceKind, row.note),
    previousCapabilities: row.previousCapabilities as AccessCapability[],
    nextCapabilities: row.nextCapabilities as AccessCapability[],
    note: row.note,
  };
}

function buildProjectInheritedSource(
  grant: AccessGrantRecord,
  subjectPrefix?: string,
): EffectiveAccessSource | null {
  if (grant.scope.type !== "platform") {
    return null;
  }

  const projectCapabilities = getProjectCapabilities(grant.capabilities);
  if (projectCapabilities.length === 0) {
    return null;
  }

  return {
    kind: "inherited",
    scope: grant.scope,
    label: subjectPrefix
      ? `${subjectPrefix} via ${getAccessGrantLabel(grant)}`
      : `via ${getAccessGrantLabel(grant)}`,
    sourcePresetKey: grant.sourcePresetKey,
    grantId: grant.id,
    capabilities: projectCapabilities,
    state: getAccessGrantVisualState(grant),
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
  };
}

function buildDirectSource(grant: AccessGrantRecord): EffectiveAccessSource {
  return {
    kind: "direct",
    scope: grant.scope,
    label: getAccessGrantLabel(grant),
    sourcePresetKey: grant.sourcePresetKey,
    grantId: grant.id,
    capabilities: grant.capabilities,
    state: getAccessGrantVisualState(grant),
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
  };
}

function isActiveGrantRecord(grant: AccessGrantRecord): boolean {
  return getAccessGrantVisualState(grant) === "active";
}

async function loadProjectNameMap(scopeIds: Array<string | null | undefined>) {
  const projectIds = [...new Set(scopeIds.filter((value): value is string => !!value))];
  if (projectIds.length === 0) {
    return new Map<string, string>();
  }

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: {
      id: true,
      name: true,
      proposal: {
        select: {
          title: true,
        },
      },
    },
  });

  return new Map(
    projects.map((project) => [project.id, getProjectName(project)]),
  );
}

async function loadProjectAccessPanelProjectInfo(projectIds: string[]): Promise<{
  projectNames: Map<string, string>;
  ownersByProjectId: Map<string, AccessSubjectSummary>;
}> {
  const uniqueProjectIds = [...new Set(projectIds.filter(Boolean))];
  if (uniqueProjectIds.length === 0) {
    return {
      projectNames: new Map(),
      ownersByProjectId: new Map(),
    };
  }

  const projects = await prisma.project.findMany({
    where: { id: { in: uniqueProjectIds } },
    select: {
      id: true,
      name: true,
      ownerScopeType: true,
      ownerScopeId: true,
      proposal: {
        select: {
          title: true,
        },
      },
    },
  });

  const projectNames = new Map(
    projects.map((project) => [project.id, getProjectName(project)]),
  );
  const ownerIdsByProjectId = new Map<string, string>();
  for (const project of projects) {
    if (project.ownerScopeType === "user" && project.ownerScopeId) {
      ownerIdsByProjectId.set(project.id, project.ownerScopeId);
    }
  }

  const ownerRowsById = new Map(
    (await listUserRowsById([...ownerIdsByProjectId.values()])).map((user) => [user.id, user]),
  );
  const ownersByProjectId = new Map<string, AccessSubjectSummary>();
  for (const [projectId, ownerId] of ownerIdsByProjectId) {
    const owner = ownerRowsById.get(ownerId);
    if (owner) {
      ownersByProjectId.set(projectId, toSubjectSummary(owner));
    }
  }

  return {
    projectNames,
    ownersByProjectId,
  };
}

async function listUserRows(): Promise<AccessUserRow[]> {
  return prisma.user.findMany({
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
    },
  });
}

async function listUserRowsById(userIds: string[]): Promise<AccessUserRow[]> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueUserIds.length === 0) return [];

  return prisma.user.findMany({
    where: { id: { in: uniqueUserIds } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
    },
  });
}

export async function listAccessSubjects(): Promise<AccessSubjectSummary[]> {
  const users = await listUserRows();
  return users.map((user) => toSubjectSummary(user));
}

export async function listProjectAccessSubjects(projectId: string): Promise<AccessSubjectSummary[]> {
  const [project, directGrantRows] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        ownerScopeType: true,
        ownerScopeId: true,
      },
    }),
    listGrantRows({
      AND: [
        { scopeType: "project", scopeId: projectId },
        buildActiveGrantWhere(),
      ],
    }),
  ]);

  const subjectIds = [
    ...(project?.ownerScopeType === "user" && project.ownerScopeId ? [project.ownerScopeId] : []),
    ...directGrantRows.map((row) => row.subjectUserId),
  ];
  const userRowsById = new Map(
    (await listUserRowsById(subjectIds)).map((user) => [user.id, user]),
  );

  return [...new Set(subjectIds)]
    .map((subjectId) => userRowsById.get(subjectId))
    .filter((user): user is AccessUserRow => !!user)
    .map((user) => toSubjectSummary(user));
}

export async function listAccessProjectOptions(): Promise<AccessProjectOption[]> {
  const projects = await prisma.project.findMany({
    where: { archivedAt: null },
    orderBy: [{ name: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      proposal: {
        select: {
          title: true,
        },
      },
    },
  });

  return projects.map((project) => ({
    id: project.id,
    name: getProjectName(project),
  }));
}

function buildActiveGrantWhere() {
  return {
    revokedAt: null,
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ],
  };
}

async function listGrantRows(where?: Record<string, unknown>): Promise<AccessGrantRow[]> {
  const delegate = getAccessGrantDelegate();
  return await delegate.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      subjectUserId: true,
      scopeType: true,
      scopeId: true,
      sourcePresetKey: true,
      sourceKind: true,
      sourceSyncedAt: true,
      customLabel: true,
      capabilities: true,
      grantedById: true,
      reason: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
      subjectUser: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
        },
      },
      grantedBy: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
}

async function listAuditRows(limit = 200): Promise<AccessAuditRow[]> {
  const delegate = getAccessAuditLogDelegate();
  return await delegate.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      action: true,
      actorUserId: true,
      subjectUserId: true,
      scopeType: true,
      scopeId: true,
      sourcePresetKey: true,
      sourceKind: true,
      previousCapabilities: true,
      nextCapabilities: true,
      note: true,
      createdAt: true,
      actorUser: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      subjectUser: {
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
        },
      },
    },
  });
}

export async function listRelevantGrantRowsForUser(
  subjectUserId: string,
  projectId?: string,
): Promise<AccessGrantRow[]> {
  const scopeFilters = projectId
    ? [{ scopeType: "platform" }, { scopeType: "project", scopeId: projectId }]
    : [{ scopeType: "platform" }];

  return listGrantRows({
    AND: [
      { subjectUserId },
      buildActiveGrantWhere(),
      { OR: scopeFilters },
    ],
  });
}

export async function listScopedGrantRowsForUser(
  subjectUserId: string,
  projectIds: string[],
): Promise<AccessGrantRow[]> {
  const uniqueProjectIds = [...new Set(projectIds.filter(Boolean))];
  const scopeFilters = uniqueProjectIds.length > 0
    ? [{ scopeType: "platform" }, { scopeType: "project", scopeId: { in: uniqueProjectIds } }]
    : [{ scopeType: "platform" }];

  return listGrantRows({
    AND: [
      { subjectUserId },
      buildActiveGrantWhere(),
      { OR: scopeFilters },
    ],
  });
}

export async function listAccessAdminData(): Promise<AccessAdminData> {
  const [users, grantRows, auditRows] = await Promise.all([
    listUserRows(),
    listGrantRows(),
    listAuditRows(),
  ]);

  const projectNames = await loadProjectNameMap([
    ...grantRows.map((row) => row.scopeType === "project" ? row.scopeId : null),
    ...auditRows.map((row) => row.scopeType === "project" ? row.scopeId : null),
  ]);

  const grants = grantRows.map((row) => toGrantRecord(row, projectNames));
  const auditEntries = auditRows.map((row) => toAuditEntry(row, projectNames));
  const grantsBySubjectId = new Map<string, AccessGrantRecord[]>();

  for (const grant of grants) {
    const list = grantsBySubjectId.get(grant.subjectUserId) ?? [];
    list.push(grant);
    grantsBySubjectId.set(grant.subjectUserId, list);
  }

  const subjects = users.map((user) => toSubjectSummary(user));
  const peopleRows = subjects.map((subject) => {
    const directGrants = grantsBySubjectId.get(subject.id) ?? [];
    const activeDirectGrants = directGrants.filter((grant) => isActiveGrantRecord(grant));
    const inheritedSources = activeDirectGrants
      .map((grant) => buildProjectInheritedSource(grant))
      .filter((entry): entry is EffectiveAccessSource => !!entry);

    const activeSources: EffectiveAccessSource[] = [
      ...activeDirectGrants.map((grant) => buildDirectSource(grant)),
    ];
    const capabilityEntries = buildEffectiveCapabilityEntries(activeSources);

    return {
      subject,
      activeGrantCount: activeDirectGrants.length,
      directGrants,
      inheritedSources,
      effectiveCapabilities: capabilityEntries.map((entry) => entry.capability),
      effectiveCapabilityEntries: capabilityEntries,
      summaryPills: activeDirectGrants.map((grant) => getAccessGrantLabel(grant)),
    };
  });

  return {
    subjects,
    peopleRows,
    grants,
    auditEntries,
  };
}

export async function getProjectAccessPanelState(
  projectId: string,
  options: { includeInheritedSources?: boolean } = {},
): Promise<ProjectAccessPanelState> {
  const states = await listProjectAccessPanelStates([projectId], options);
  return states[projectId];
}

export async function listProjectAccessPanelStates(
  projectIds: string[],
  options: { includeInheritedSources?: boolean } = {},
): Promise<Record<string, ProjectAccessPanelState>> {
  const uniqueProjectIds = [...new Set(projectIds)];
  if (uniqueProjectIds.length === 0) {
    return {};
  }
  const includeInheritedSources = options.includeInheritedSources ?? false;

  const [projectInfo, directGrantRows, inheritedGrantRows] = await Promise.all([
    loadProjectAccessPanelProjectInfo(uniqueProjectIds),
    listGrantRows({
      scopeType: "project",
      scopeId: { in: uniqueProjectIds },
    }),
    includeInheritedSources
      ? listGrantRows({
        AND: [
          { scopeType: "platform" },
          buildActiveGrantWhere(),
          { capabilities: { hasSome: [...PROJECT_ACCESS_CAPABILITIES] } },
        ],
      })
      : Promise.resolve([]),
  ]);
  const { projectNames, ownersByProjectId } = projectInfo;

  const directGrantsByProjectId = new Map<string, AccessGrantRecord[]>();
  for (const row of directGrantRows) {
    if (!row.scopeId) continue;
    const list = directGrantsByProjectId.get(row.scopeId) ?? [];
    list.push(toGrantRecord(row, projectNames));
    directGrantsByProjectId.set(row.scopeId, list);
  }

  const inheritedSources = inheritedGrantRows
    .map((row) => toGrantRecord(row, projectNames))
    .map((grant) => buildProjectInheritedSource(
      grant,
      grant.subject?.name ?? grant.subject?.email ?? grant.subjectUserId,
    ))
    .filter((entry): entry is EffectiveAccessSource => !!entry);

  return Object.fromEntries(
    uniqueProjectIds.map((projectId) => {
      const directGrants = directGrantsByProjectId.get(projectId) ?? [];
      return [
        projectId,
        {
          scope: buildScopeRef("project", projectId, projectNames),
          owner: ownersByProjectId.get(projectId) ?? null,
          directGrants,
          inheritedSources,
          hasAnyDirectGrant: directGrants.length > 0,
        } satisfies ProjectAccessPanelState,
      ];
    }),
  );
}

export async function listManagedProjectsForUser(userId: string) {
  const activeGrantRows = await listGrantRows({
    AND: [
      { subjectUserId: userId },
      buildActiveGrantWhere(),
      { scopeType: "project" },
      { capabilities: { hasSome: ACTIVE_PROJECT_DASHBOARD_CAPABILITIES } },
    ],
  });

  const grantedProjectIds = activeGrantRows
    .map((grant) => grant.scopeId)
    .filter((scopeId): scopeId is string => !!scopeId);

  const ownedProjects = await prisma.project.findMany({
    where: {
      ownerScopeType: "user",
      ownerScopeId: userId,
      archivedAt: null,
      NOT: { mode: "personal" },
    },
    orderBy: { updatedAt: "desc" },
    omit: { log: true, specSnapshot: true, progressJson: true },
    include: {
      budget: {
        select: {
          isEnabled: true,
          totalCreditsUsd: true,
          usedCreditsUsd: true,
        },
      },
      components: {
        select: {
          powerIntent: true,
          runtimeState: true,
          agentState: true,
          blockers: true,
          lastOutcome: true,
          provisionedAt: true,
        },
      },
    },
  });

  const ownedProjectIds = new Set(ownedProjects.map((project) => project.id));
  const extraGrantProjectIds = [...new Set(grantedProjectIds)].filter((projectId) => !ownedProjectIds.has(projectId));

  const grantedProjects = extraGrantProjectIds.length > 0
    ? await prisma.project.findMany({
      where: {
        id: { in: extraGrantProjectIds },
        archivedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      omit: { log: true, specSnapshot: true, progressJson: true },
      include: {
        budget: {
          select: {
            isEnabled: true,
            totalCreditsUsd: true,
            usedCreditsUsd: true,
          },
        },
        components: {
          select: {
            powerIntent: true,
            runtimeState: true,
            agentState: true,
            blockers: true,
            lastOutcome: true,
            provisionedAt: true,
          },
        },
      },
    })
    : [];

  return [
    ...ownedProjects,
    ...grantedProjects,
  ];
}
