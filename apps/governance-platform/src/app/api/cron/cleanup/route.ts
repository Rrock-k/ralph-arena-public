import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listSshKeys, deleteSshKey } from "@/lib/vps/hetzner";
import { isCronAuthorized } from "@/lib/internal-auth";

/**
 * POST /api/cron/cleanup
 *
 * RA-082: Finds orphaned Hetzner SSH keys (arena-* prefix, no matching VpsHost) and deletes them.
 *
 * Runtime cleanup no longer lives here. Powered-off runtime convergence is owned by
 * runtime-intents / reaper, not by a second cron mutating preview metadata.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await cleanupOrphanedSshKeys());
}

/**
 * RA-082: Delete Hetzner SSH keys that start with "arena-" but have no matching VpsHost in DB.
 */
async function cleanupOrphanedSshKeys(): Promise<{ orphanedKeysDeleted: number }> {
  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) return { orphanedKeysDeleted: 0 };

  try {
    const knownHosts = await (prisma as any).vpsHost.findMany({
      select: { providerKeyId: true },
    });
    const knownKeyIds = new Set<string>(
      knownHosts.map((h: any) => String(h.providerKeyId)).filter(Boolean),
    );

    const allKeys = await listSshKeys(apiToken);
    const orphans = allKeys.filter(
      (key) => key.name.startsWith("arena-") && !knownKeyIds.has(key.id),
    );

    let deleted = 0;
    for (const key of orphans) {
      try {
        await deleteSshKey(apiToken, key.id);
        deleted++;
      } catch (err) {
        console.error(`[cleanup] Failed to delete orphan SSH key ${key.id} (${key.name}):`, err);
      }
    }

    if (deleted > 0) {
      console.log(`[cleanup] Deleted ${deleted} orphaned SSH key(s)`);
    }

    return { orphanedKeysDeleted: deleted };
  } catch (err) {
    console.error("[cleanup] SSH key orphan check failed:", err);
    return { orphanedKeysDeleted: 0 };
  }
}
