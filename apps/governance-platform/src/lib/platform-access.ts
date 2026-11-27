import { auth } from "@/lib/auth";
import { hasE2EAdminBypass } from "@/lib/e2e-auth-bypass";
import { ACCESS_PRESET_DEFINITIONS } from "@/lib/access-control/presets";
import { listRelevantGrantRowsForUser } from "@/lib/access-control/server";
import { getAccessGrantLabel, buildEffectiveCapabilityEntries } from "@/lib/access-control/utils";
import type { Session } from "next-auth";
import type {
  AccessCapability,
  AccessPresetKey,
  PlatformAccessCapability,
  EffectiveAccessSource,
} from "@/lib/access-control/types";

const PLATFORM_CAPABILITY_SET = new Set<string>([
  "platform.ops.view",
  "platform.projects.view",
  "platform.projects.manage",
  "platform.registry.manage",
  "platform.governance.manage",
  "platform.finance.manage",
  "platform.flags.manage",
  "platform.runtime.manage",
  "platform.access.manage",
]);

function isPlatformCapability(capability: string): capability is PlatformAccessCapability {
  return PLATFORM_CAPABILITY_SET.has(capability);
}

function bypassSource(): EffectiveAccessSource {
  return {
    kind: "direct",
    scope: { type: "platform", label: "Platform" },
    label: "E2E bypass",
    sourcePresetKey: "superadmin",
    grantId: null,
    capabilities: ACCESS_PRESET_DEFINITIONS.superadmin.capabilities.filter(isPlatformCapability),
    state: "active",
    expiresAt: null,
    revokedAt: null,
  };
}

function grantSource(
  row: Awaited<ReturnType<typeof listRelevantGrantRowsForUser>>[number],
): EffectiveAccessSource | null {
  const platformCapabilities = row.capabilities.filter(isPlatformCapability);
  if (platformCapabilities.length === 0) {
    return null;
  }

  const sourcePresetKey = row.sourcePresetKey as AccessPresetKey | null;
  return {
    kind: "direct",
    scope: { type: "platform", label: "Platform" },
    label: getAccessGrantLabel({
      customLabel: row.customLabel,
      sourcePresetKey,
      capabilities: platformCapabilities,
    }),
    sourcePresetKey,
    grantId: row.id,
    capabilities: platformCapabilities,
    state: "active",
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function hasCapability(
  capabilities: AccessCapability[],
  required: PlatformAccessCapability,
): boolean {
  return capabilities.includes(required);
}

function hasAnyCapability(
  capabilities: AccessCapability[],
  required: PlatformAccessCapability[],
): boolean {
  return required.some((capability) => capabilities.includes(capability));
}

type SessionLike = Session | null;

export async function resolvePlatformAccess(
  session: SessionLike,
  hasBypass = false,
) {
  const grantSources = !hasBypass && session?.user?.id
    ? (await listRelevantGrantRowsForUser(session.user.id))
      .map((row) => grantSource(row))
      .filter((row): row is EffectiveAccessSource => !!row)
    : [];

  const activeSources: EffectiveAccessSource[] = [
    ...(hasBypass ? [bypassSource()] : []),
    ...grantSources,
  ];

  const effectiveCapabilityEntries = buildEffectiveCapabilityEntries(activeSources);
  const effectiveCapabilities = effectiveCapabilityEntries
    .map((entry) => entry.capability)
    .filter(isPlatformCapability);

  return {
    canOpenOps: hasAnyCapability(effectiveCapabilities, [
      "platform.ops.view",
      "platform.projects.view",
      "platform.projects.manage",
      "platform.governance.manage",
      "platform.finance.manage",
      "platform.registry.manage",
      "platform.flags.manage",
      "platform.runtime.manage",
      "platform.access.manage",
    ]),
    sources: activeSources,
    effectiveCapabilities,
    effectiveCapabilityEntries: effectiveCapabilityEntries.filter((entry) => isPlatformCapability(entry.capability)),
    hasCapability: (required: PlatformAccessCapability) => hasCapability(effectiveCapabilities, required),
    hasAnyCapability: (required: PlatformAccessCapability[]) => hasAnyCapability(effectiveCapabilities, required),
  };
}

async function requirePlatformAccessBase() {
  const [session, hasBypass] = await Promise.all([
    auth(),
    hasE2EAdminBypass(),
  ]);
  const access = await resolvePlatformAccess(session, hasBypass);

  if (!session?.user && !hasBypass) {
    return {
      authorized: false as const,
      error: "Unauthorized",
      session,
      hasBypass,
      ...access,
    };
  }

  return {
    authorized: true as const,
    session,
    hasBypass,
    ...access,
  };
}

export async function requirePlatformCapability(capability: PlatformAccessCapability) {
  const base = await requirePlatformAccessBase();
  if (!base.authorized) {
    return base;
  }

  if (!base.hasCapability(capability)) {
    return {
      ...base,
      authorized: false as const,
      error: "Platform access denied",
    };
  }

  return base;
}

export async function requireAnyPlatformCapability(capabilities: PlatformAccessCapability[]) {
  const base = await requirePlatformAccessBase();
  if (!base.authorized) {
    return base;
  }

  if (!base.hasAnyCapability(capabilities)) {
    return {
      ...base,
      authorized: false as const,
      error: "Platform access denied",
    };
  }

  return base;
}
