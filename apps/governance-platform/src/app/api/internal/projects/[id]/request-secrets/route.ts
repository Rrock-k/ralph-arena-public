import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged } from "@/lib/progress-bus";
import { isRunnerAuthorized } from "@/lib/internal-auth";
import { decryptSecret, getEncryptionKey } from "@/lib/crypto";
import { getProjectProposalPath } from "@/lib/project-identity";
import {
  mergeRequiredSecrets,
  normalizeRequiredSecretKey,
  parseRequiredSecrets,
  isValidRequiredSecretKey,
  type RequiredSecretEntry,
} from "@/lib/required-secrets";
import { applyStateChange, getPrimaryComponentRow } from "@/lib/project-state-effects";
import { buildProjectSecretsFocusHref } from "@/lib/project-interaction-deeplink";
import { enqueueProjectUpdate } from "@/lib/project-update-outbox";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type RequestSecretEntry = {
  key?: string;
  description?: string;
  blocking?: boolean;
};

type TransactionClient = Prisma.TransactionClient;

function normalizeEntries(body: unknown): RequiredSecretEntry[] | null {
  if (!Array.isArray(body)) return null;
  const normalized: RequiredSecretEntry[] = [];
  for (const entry of body as RequestSecretEntry[]) {
    const key = normalizeRequiredSecretKey(entry?.key);
    if (!key || !isValidRequiredSecretKey(key)) continue;
    normalized.push({
      key,
      ...(entry?.description?.trim() ? { description: entry.description.trim() } : {}),
      blocking: entry?.blocking !== false,
      requestedAt: new Date().toISOString(),
    });
  }
  return normalized;
}

/**
 * POST /api/internal/projects/:id/request-secrets
 *
 * RA-098: Runner requests secrets, governance pauses if blocking secrets are missing.
 * RA-237: Uses applyStateChange(addBlocker=SECRETS) instead of old patchPrimaryComponent.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isRunnerAuthorized(request, { projectId: id })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const entries = normalizeEntries(body);
  if (!entries || entries.length === 0) {
    return NextResponse.json({ error: "Body must be a JSON array of {key, description?, blocking?}" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      archivedAt: true,
      proposalId: true,
      requiredSecrets: true,
      secrets: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const existingRequired = parseRequiredSecrets(project.requiredSecrets);
  const entriesWithProject = entries.map((entry) => ({
    ...entry,
    requestedByProjectId: project.id,
  }));
  const { list: nextRequired, changed } = mergeRequiredSecrets(existingRequired, entriesWithProject);

  const existingSecrets = new Map(project.secrets.map((secret) => [secret.key, secret]));
  const provided: Record<string, string> = {};
  const missing = entriesWithProject.filter((entry) => !existingSecrets.has(entry.key));

  if (existingSecrets.size > 0) {
    const encKey = getEncryptionKey();
    for (const entry of entriesWithProject) {
      const secret = existingSecrets.get(entry.key);
      if (!secret) continue;
      provided[entry.key] = decryptSecret(
        { ciphertext: secret.encryptedValue, iv: secret.iv, authTag: secret.authTag },
        encKey,
      );
    }
  }

  const blockingMissing = missing.filter((entry) => entry.blocking !== false);
  const shouldPause = blockingMissing.length > 0;

  const row = await getPrimaryComponentRow(prisma, id);
  const alreadyBlocked = row?.blockers.includes("SECRETS");

  await prisma.$transaction(async (tx: TransactionClient) => {
    if (changed) {
      await tx.project.update({
        where: { id },
        data: { requiredSecrets: JSON.stringify(nextRequired) },
      });
    }

    if (shouldPause && !alreadyBlocked) {
      const blockReason = `Missing required secret(s): ${blockingMissing.map((entry) => entry.key).join(", ")}`;
      // RA-237: addBlocker with source="system" (boundary adapter — runner reports, governance creates blocker)
      await applyStateChange(tx, id, { type: "addBlocker", blocker: "SECRETS" }, {
        source: "system",
        trigger: "request_secrets",
        reason: blockReason,
      });
    }

    if (shouldPause && !alreadyBlocked) {
      const requiredSecretKeys = blockingMissing.map((entry) => entry.key);
      const dedupeAt = entriesWithProject
        .map((entry) => entry.requestedAt)
        .filter(Boolean)
        .sort()[0] ?? new Date().toISOString();
      await enqueueProjectUpdate(tx, {
        projectId: id,
        eventType: "required_secret.missing",
        dedupeKey: `request-secrets:${requiredSecretKeys.slice().sort().join(",")}:${dedupeAt}`,
        payload: {
          requiredSecretKeys,
          actionHref: buildProjectSecretsFocusHref(id, requiredSecretKeys[0], { action: "provide" }),
        },
      });
    }
  });

  if (changed || shouldPause) {
    notifyProjectChanged(id);
    revalidatePath("/admin");

    revalidatePath(`/admin/projects/${id}`);
    revalidatePath(`/projects/${id}`);
    const proposalPath = getProjectProposalPath(project);
    if (proposalPath) revalidatePath(proposalPath);
  }

  return NextResponse.json({
    provided,
    missing,
    paused: Boolean(shouldPause),
  });
}
