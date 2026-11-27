import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyProjectChanged, notifyProjectEvent } from "@/lib/progress-bus";
import { appendLifecycle } from "@/lib/log-writer";
import { encryptSecret, getEncryptionKey } from "@/lib/crypto";
import { provisionVps, createDnsRecords } from "@/lib/vps/hetzner";
import { isCronAuthorized } from "@/lib/internal-auth";
import { getProjectName } from "@/lib/project-identity";
import { getPrimaryLifecycleComponent } from "@/lib/project-lifecycle";
import { requirePrimaryComponentRow } from "@/lib/project-state-effects";
import { parkInfraBlocked } from "@/lib/claim-blockers";
import {
  hasLegacyAgentProjectRecipe,
  isAwaitingFirstTgSpecImport,
  isTgSpecTargetSourceConfig,
} from "@/lib/tg-spec-target";
import {
  VISUAL_WORKBENCH_CANARY_SOURCE_SEED_PROFILE,
  getSourceSeedProfile,
  type SourceSeedProfile,
} from "@/lib/source-seed-profile";
import {
  VISUAL_WORKBENCH_MANIFEST_PATH,
  VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
  type VisualWorkbenchManifest,
} from "@arena/contracts";

type TransactionClient = Prisma.TransactionClient;

const VPS_WORKER_HEALTH_TIMEOUT_MS = 5_000;
const VPS_WORKER_BOOT_TIMEOUT_MS = 15 * 60_000;

type VpsHostReadinessRecord = {
  id: string;
  ip: string | null;
  status: string | null;
  createdAt: Date | string;
};

/**
 * POST /api/cron/provisioner
 *
 * Picks up projects that need provisioning (powerIntent=ON, runtimeState=ABSENT, agentState=IDLE, provisionedAt=NULL)
 * and prepares infrastructure:
 * - Creates GitHub repo (if needed)
 * - Provisions VPS (if backend = "vps" and no existing host)
 * - Registers with API proxy
 * - Sets provisionedAt when ready (makes project claimable by worker)
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      components: {
        some: {
          powerIntent: "ON",
          runtimeState: "ABSENT",
          blockers: { isEmpty: true },
          OR: [{ agentState: "IDLE" }, { agentState: null }],
          provisionedAt: null,
        },
      },
    },
    include: {
      components: {
        where: { kind: "app" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          id: true,
          kind: true,
          sourceType: true,
          runtimeConfig: true,
          sourceConfig: true,
        },
      },
      proposal: { select: { id: true, title: true } },
      vpsHost: true,
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });

  if (!projects.length) {
    return NextResponse.json({ provisioned: 0, pausedInfra: 0 });
  }

  const provisioned: string[] = [];
  const pausedInfra: string[] = [];
  const cronCtx = { source: "cron" as const, trigger: "provisioner" };

  for (const project of projects) {
    try {
      let repoUrl = project.repoUrl;
      const primaryComponent = getPrimaryLifecycleComponent(project);

      if (
        isAwaitingFirstTgSpecImport(
          primaryComponent?.sourceConfig,
          project.tgSpecLastImportedVersion,
        )
      ) {
        console.log(
          `[provisioner] Project ${project.id} is a tg-spec target waiting for first import — skipping`,
        );
        continue;
      }

      // 1. Create GitHub repo if none exists
      if (!repoUrl && shouldCreateRepoForProject(primaryComponent)) {
        const result = await createRepoForProject(project, {
          managedAgentProjectSeedProfile: resolveManagedAgentProjectSeedProfile(primaryComponent),
        });
        if (result) {
          repoUrl = result.repoUrl;
          await prisma.project.update({
            where: { id: project.id },
            data: { repoUrl: result.repoUrl, repoBranch: result.repoBranch },
          });
          await appendLifecycle(project.id, "REPO_CREATED");
        }
      }

      // 2. Provision VPS if needed; runtime claim opens only after worker-agent is healthy.
      const backend = project.runnerBackend || "local";
      if (backend === "vps" && !project.vpsHost) {
        // RA-125: Placeholder insert uses unique projectId constraint as atomic lock.
        // Concurrent cron invocations will hit P2002 and skip (not double-provision).
        let placeholder;
        try {
          placeholder = await prisma.vpsHost.create({
            data: {
              projectId: project.id,
              providerServerId: "",
              ip: "",
              status: "PROVISIONING",
              sshPrivateKey: "",
              sshPrivateKeyIv: "",
              sshPrivateKeyTag: "",
              sshPublicKey: "",
            },
          });
        } catch (err: any) {
          if (err?.code === "P2002") {
            console.log(
              `[provisioner] VPS placeholder already exists for project ${project.id} — skipping (concurrent cron)`,
            );
            continue;
          }
          throw err;
        }
        try {
          await provisionVpsForProject(project);
          await appendLifecycle(project.id, "VPS_PROVISIONED");
          continue;
        } catch (err) {
          // Clean up placeholder on failure so next attempt can retry
          await prisma.vpsHost
            .delete({ where: { id: placeholder.id } })
            .catch(() => {});
          throw err;
        }
      }
      if (backend === "vps" && project.vpsHost) {
        const readiness = await ensureVpsWorkerReady(project.id, project.vpsHost);
        if (!readiness.ready) {
          if (isVpsWorkerBootExpired(project.vpsHost)) {
            await markVpsWorkerError(project.vpsHost.id, readiness.reason);
            throw new Error(`VPS worker readiness timed out: ${readiness.reason}`);
          }
          console.log(
            `[provisioner] VPS worker for project ${project.id} is not ready yet: ${readiness.reason}`,
          );
          continue;
        }
      }

      // 3. Register with API proxy
      const apiProxyUrl =
        process.env.API_PROXY_URL || process.env.API_PROXY_HOST_URL;
      if (apiProxyUrl) {
        try {
          const budget = await prisma.projectBudget.findUnique({
            where: { projectId: project.id },
          });
          await fetch(`${apiProxyUrl}/projects/${project.id}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: project.id,
              providerBillingMode: project.providerBillingMode ?? "byok",
              budgetLimitUsd: budget?.isEnabled
                ? budget.totalCreditsUsd - budget.usedCreditsUsd
                : null,
            }),
            signal: AbortSignal.timeout(5000),
          });
        } catch (err) {
          console.warn(
            `[provisioner] API proxy registration failed for project ${project.id}:`,
            err,
          );
        }
      }

      // 4. Mark as provisioned (atomic: only if component is still in provisioning state)
      if (!primaryComponent) {
        console.log(
          `[provisioner] Project ${project.id} has no primary component — skipping`,
        );
        continue;
      }

      const marked = await prisma.$transaction(
        async (tx: TransactionClient) => {
          // Re-check component state atomically
          const comp = await tx.projectComponent.findFirst({
            where: {
              id: primaryComponent.id,
              powerIntent: "ON",
              runtimeState: "ABSENT",
              blockers: { isEmpty: true },
              OR: [{ agentState: "IDLE" }, { agentState: null }],
              provisionedAt: null,
            },
          });
          if (!comp) return false;

          await tx.projectComponent.update({
            where: { id: primaryComponent.id },
            data: { provisionedAt: new Date() },
          });

          return true;
        },
      );

      if (!marked) {
        console.log(
          `[provisioner] Project ${project.id} component state changed during provisioning — skipping`,
        );
        continue;
      }

      await appendLifecycle(project.id, "QUEUED");

      await prisma.runLog.create({
        data: {
          projectId: project.id,
          event: "QUEUED",
          detail: JSON.stringify({
            from: "PROVISIONING",
            trigger: "provisioner",
          }),
        },
      });

      notifyProjectEvent(project.id, {
        type: "project_progress",
        status: "QUEUED",
      });

      provisioned.push(project.id);
    } catch (err) {
      console.error(
        `[provisioner] Failed to provision project ${project.id}:`,
        err,
      );

      const failureMessage = `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`;
      const markedPaused = await prisma.$transaction(
        async (tx: TransactionClient) => {
          const row = await requirePrimaryComponentRow(tx, project.id);
          // Only pause if still in the pre-runtime provisioning shape.
          if (
            row.powerIntent !== "ON" ||
            row.runtimeState !== "ABSENT" ||
            (row.blockers?.length ?? 0) > 0 ||
            (row.agentState !== "IDLE" && row.agentState != null)
          ) {
            return false;
          }

          await parkInfraBlocked(
            tx,
            project.id,
            "provisioning_failed",
            cronCtx.trigger,
            {
              source: "cron",
            },
          );

          return true;
        },
      );

      if (!markedPaused) {
        console.log(
          `[provisioner] Project ${project.id} left provisioning state before infra pause transition`,
        );
        continue;
      }

      notifyProjectChanged(project.id);

      pausedInfra.push(project.id);
    }
  }

  if (provisioned.length || pausedInfra.length) {
    console.log(
      `[provisioner] Provisioned: ${provisioned.length}, Paused INFRA: ${pausedInfra.length}`,
    );
  }

  return NextResponse.json({
    provisioned: provisioned.length,
    pausedInfra: pausedInfra.length,
  });
}

function shouldCreateRepoForProject(
  component: {
    sourceType: string;
    runtimeConfig: unknown;
  } | null,
): boolean {
  if (!component) return true;

  const runtimeConfig =
    component.runtimeConfig && typeof component.runtimeConfig === "object"
      ? (component.runtimeConfig as Record<string, unknown>)
      : null;

  const repoProvisioning =
    typeof runtimeConfig?.repoProvisioning === "string"
      ? runtimeConfig.repoProvisioning
      : null;
  if (repoProvisioning === "skip") {
    return false;
  }
  if (repoProvisioning === "required") {
    return true;
  }

  const bootstrap =
    typeof runtimeConfig?.bootstrap === "string"
      ? runtimeConfig.bootstrap
      : null;

  // RA-142: direct-command recipe runtimes are allowed to run without a git repo.
  if (bootstrap === "direct_command") {
    return false;
  }

  return true;
}

type ManagedAgentProjectSeedProfile = "managed_starter" | SourceSeedProfile;

function resolveManagedAgentProjectSeedProfile(
  component: {
    sourceType: string;
    sourceConfig: unknown;
  } | null,
): ManagedAgentProjectSeedProfile | null {
  if (component?.sourceType !== "managed") {
    return null;
  }

  const sourceSeedProfile = getSourceSeedProfile(component.sourceConfig);
  if (hasLegacyAgentProjectRecipe(component.sourceConfig)) {
    return sourceSeedProfile ?? "managed_starter";
  }
  if (isTgSpecTargetSourceConfig(component.sourceConfig)) {
    return sourceSeedProfile;
  }
  return null;
}

// ── VPS provisioning ──────────────────────────

async function provisionVpsForProject(project: {
  id: string;
  name?: string | null;
  vpsServerType?: string | null;
  proposal?: { id: string; title: string } | null;
}): Promise<void> {
  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) {
    throw new Error("Missing HETZNER_API_TOKEN: cannot provision VPS");
  }

  const label = getProjectName(project, "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);

  // RA-133: Compute VPS preview domain BEFORE provisioning so cloud-init gets the correct PREVIEW_DOMAIN
  const basePreviewDomain = process.env.PREVIEW_DOMAIN || "local";
  const dnsToken = process.env.HETZNER_DNS_TOKEN;
  const dnsZoneId = process.env.HETZNER_DNS_ZONE_ID;
  const hasDns = !!(
    dnsToken &&
    dnsZoneId &&
    basePreviewDomain !== "local" &&
    !basePreviewDomain.includes("localhost")
  );
  const previewSubdomain = hasDns ? `vps-${project.id.slice(-8)}` : null;
  const vpsPreviewDomain = previewSubdomain
    ? `${previewSubdomain}.${basePreviewDomain}`
    : "auto";

  const result = await provisionVps(
    {
      apiToken,
      defaultRegion: process.env.HETZNER_DEFAULT_REGION || "ash",
      defaultServerType: process.env.HETZNER_DEFAULT_SERVER_TYPE || "cpx11",
      workerImage: process.env.WORKER_IMAGE || "arena-public-worker:local",
      previewDomain: vpsPreviewDomain,
      acmeEmail: process.env.ACME_EMAIL || "admin@arena.example.test",
      githubToken: process.env.GITHUB_TOKEN,
      governanceUrl:
        process.env.GOVERNANCE_PUBLIC_URL ||
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        "",
      workerSecret:
        process.env.WORKER_SECRET || process.env.RUNNER_WEBHOOK_SECRET || "",
    },
    label,
    project.vpsServerType ? { serverType: project.vpsServerType } : undefined,
  );

  const actualServerType =
    project.vpsServerType || process.env.HETZNER_DEFAULT_SERVER_TYPE || "cpx11";
  const encKey = getEncryptionKey();
  const encrypted = encryptSecret(result.sshKey.privateKey, encKey);

  if (previewSubdomain) {
    await createDnsRecords(dnsToken!, dnsZoneId!, previewSubdomain, result.ip);
  }

  const resolvedPreviewDomain = previewSubdomain
    ? vpsPreviewDomain
    : `${result.ip}.nip.io`;

  await prisma.vpsHost.upsert({
    where: { projectId: project.id },
    create: {
      projectId: project.id,
      providerServerId: result.serverId,
      providerKeyId: result.sshKeyId,
      ip: result.ip,
      status: "PROVISIONING",
      errorMessage: null,
      serverType: actualServerType,
      sshPrivateKey: encrypted.ciphertext,
      sshPrivateKeyIv: encrypted.iv,
      sshPrivateKeyTag: encrypted.authTag,
      sshPublicKey: result.sshKey.publicKey,
      previewDomain: resolvedPreviewDomain,
    },
    update: {
      providerServerId: result.serverId,
      providerKeyId: result.sshKeyId,
      ip: result.ip,
      status: "PROVISIONING",
      errorMessage: null,
      serverType: actualServerType,
      sshPrivateKey: encrypted.ciphertext,
      sshPrivateKeyIv: encrypted.iv,
      sshPrivateKeyTag: encrypted.authTag,
      sshPublicKey: result.sshKey.publicKey,
      previewDomain: resolvedPreviewDomain,
    },
  });

  console.log(
    `[provisioner] VPS provisioned for project ${project.id}: ${result.ip}; waiting for worker readiness`,
  );
}

async function ensureVpsWorkerReady(
  projectId: string,
  host: VpsHostReadinessRecord,
): Promise<{ ready: true } | { ready: false; reason: string }> {
  if (!host.ip?.trim()) {
    return { ready: false, reason: "missing VPS IP" };
  }

  const health = await checkVpsWorkerHealth(host.ip, {
    acceptLegacyReadyHealth: host.status === "READY",
  });
  if (!health.ready) {
    if (host.status === "READY") {
      await prisma.vpsHost.update({
        where: { id: host.id },
        data: {
          status: "PROVISIONING",
          errorMessage: health.reason,
        },
      });
    }
    return health;
  }

  await prisma.vpsHost.update({
    where: { id: host.id },
    data: {
      status: "READY",
      errorMessage: null,
    },
  });
  console.log(`[provisioner] VPS worker ready for project ${projectId} (${host.ip})`);
  return { ready: true };
}

async function checkVpsWorkerHealth(
  ip: string,
  opts?: { acceptLegacyReadyHealth?: boolean },
): Promise<{ ready: true } | { ready: false; reason: string }> {
  const url = `http://${ip}:4200/health`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(VPS_WORKER_HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ready: false, reason: `worker health returned HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => null) as {
      ok?: unknown;
      governanceReachable?: unknown;
      runtimeIntentClaim?: { lastSuccessAt?: unknown; lastError?: unknown } | null;
    } | null;
    if (body?.ok !== true) {
      return { ready: false, reason: "worker health response missing ok=true" };
    }
    if (body.governanceReachable === undefined && opts?.acceptLegacyReadyHealth) {
      return { ready: true };
    }
    if (body.governanceReachable !== true) {
      const lastError = typeof body.runtimeIntentClaim?.lastError === "string"
        ? body.runtimeIntentClaim.lastError
        : "no successful claim poll yet";
      return { ready: false, reason: `worker has not reached governance claim endpoint: ${lastError}` };
    }
    return { ready: true };
  } catch (err) {
    return {
      ready: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function isVpsWorkerBootExpired(host: VpsHostReadinessRecord): boolean {
  const createdAt = new Date(host.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt > VPS_WORKER_BOOT_TIMEOUT_MS;
}

async function markVpsWorkerError(hostId: string, reason: string): Promise<void> {
  await prisma.vpsHost.update({
    where: { id: hostId },
    data: {
      status: "ERROR",
      errorMessage: `Worker readiness timeout: ${reason}`,
    },
  });
}

// ── GitHub repo creation ──────────────────────────

async function createRepoForProject(project: {
  id: string;
  name?: string | null;
  proposal?: { id: string; title: string } | null;
}, opts?: {
  managedAgentProjectSeedProfile?: ManagedAgentProjectSeedProfile | null;
}): Promise<{ repoUrl: string; defaultBranch: string; repoBranch: string } | null> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("Missing GITHUB_TOKEN: cannot create repository");
  }

  const prefix = process.env.GITHUB_REPO_PREFIX || "arena";
  const owner = process.env.GITHUB_OWNER || "";

  const viewer = await githubApi<{ login: string }>("GET", "/user", token);
  const repoOwner = owner || viewer.login;
  const endpoint =
    repoOwner.toLowerCase() === viewer.login.toLowerCase()
      ? "/user/repos"
      : `/orgs/${repoOwner}/repos`;

  const title = getProjectName(project);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const ts = Date.now().toString(36).slice(-5);
  const candidates = [
    `${prefix}-${slug}`,
    project.proposal?.id
      ? `${prefix}-${slug}-${project.proposal.id.slice(-4)}`
      : null,
    `${prefix}-${project.id.slice(-8)}`,
    `${prefix}-${slug}-${ts}`,
  ].filter(Boolean) as string[];

  for (const name of candidates) {
    let created: {
      html_url: string;
      full_name: string;
      default_branch: string;
    };
    try {
      created = await githubApi<{
        html_url: string;
        full_name: string;
        default_branch: string;
      }>("POST", endpoint, token, {
        name,
        description: `Autonomous project: "${title}"`,
        private: true,
        auto_init: true,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("422")) continue;
      throw err;
    }

    const defaultBranch = created.default_branch || "main";
    const repoBranch = opts?.managedAgentProjectSeedProfile
      ? await seedManagedAgentProjectRepo({
        token,
        fullName: created.full_name,
        defaultBranch,
        projectId: project.id,
        title,
        seedProfile: opts.managedAgentProjectSeedProfile,
      })
      : defaultBranch;
    return {
      repoUrl: created.html_url,
      defaultBranch,
      repoBranch,
    };
  }

  throw new Error("All repo name candidates exhausted");
}

async function seedManagedAgentProjectRepo(input: {
  token: string;
  fullName: string;
  defaultBranch: string;
  projectId: string;
  title: string;
  seedProfile: ManagedAgentProjectSeedProfile;
}): Promise<string> {
  const projectBranch = `arena/project-${input.projectId}`;
  const defaultRef = await githubApi<{
    object: { sha: string };
  }>(
    "GET",
    `/repos/${input.fullName}/git/ref/heads/${encodeURIComponent(input.defaultBranch)}`,
    input.token,
  );

  await githubApi("POST", `/repos/${input.fullName}/git/refs`, input.token, {
    ref: `refs/heads/${projectBranch}`,
    sha: defaultRef.object.sha,
  });

  for (const file of buildManagedAgentProjectStarter(input.title, input.seedProfile)) {
    await githubApi(
      "PUT",
      `/repos/${input.fullName}/contents/${encodeGithubContentPath(file.path)}`,
      input.token,
      {
        message: `Seed managed project starter: ${file.path}`,
        branch: projectBranch,
        content: Buffer.from(file.content, "utf8").toString("base64"),
      },
    );
  }

  return projectBranch;
}

function buildManagedAgentProjectStarter(title: string, seedProfile: ManagedAgentProjectSeedProfile): Array<{
  path: string;
  content: string;
}> {
  const safeTitle = JSON.stringify(title);
  const includeVisualWorkbench = seedProfile === VISUAL_WORKBENCH_CANARY_SOURCE_SEED_PROFILE;
  const starterStoryId = "managed-starter.ready";
  const starterStoryPath = `/__visual/${starterStoryId}`;
  const visualWorkbenchManifest: VisualWorkbenchManifest = {
    schemaVersion: VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION,
    projectClass: "ordinary_web",
    workbench: {
      serveCommand: "npm run visual-workbench",
      baseUrlEnv: "VISUAL_WORKBENCH_BASE_URL",
      storyRoutePattern: "/__visual/:storyId",
    },
    coveragePolicy: {
      mode: "strict_canary",
      selectionDefault: "full_manifest",
      simplificationRequiresEvidence: true,
    },
    stories: [
      {
        id: starterStoryId,
        title: "Managed starter / ready",
        kind: "feature",
        feature: "managed-starter",
        widget: "StarterPage",
        state: "ready",
        claim: "The managed starter source has a preview-ready page and a Visual Workbench harness for the first UI replacement task.",
        render: {
          type: "workbench_route",
          path: starterStoryPath,
        },
        mockState: {
          name: "starter-ready",
        },
        viewports: [
          { name: "desktop", width: 1280, height: 720 },
          { name: "mobile", width: 390, height: 844 },
        ],
        tags: ["starter", "visual-workbench"],
        taskRelevance: {
          defaultFor: ["feature:managed-starter", "widget:StarterPage"],
        },
      },
    ],
  };

  const files = [
    {
      path: "arena-start.sh",
      content: [
        "#!/usr/bin/env sh",
        "set -eu",
        "export PORT=\"${PORT:-3000}\"",
        "exec node server.mjs",
        "",
      ].join("\n"),
    },
    {
      path: "package.json",
      content: `${JSON.stringify(
        {
          scripts: {
            start: "node server.mjs",
            ...(includeVisualWorkbench ? { "visual-workbench": "node server.mjs" } : {}),
          },
          dependencies: {},
          devDependencies: {},
        },
        null,
        2,
      )}\n`,
    },
    {
      path: "server.mjs",
      content: [
        'import http from "node:http";',
        "",
        `const projectTitle = ${safeTitle};`,
        'const host = "0.0.0.0";',
        ...(includeVisualWorkbench
          ? [
            "const visualWorkbenchBaseUrl = process.env.VISUAL_WORKBENCH_BASE_URL || '';",
            "const visualWorkbenchStoryId = 'managed-starter.ready';",
            "const visualWorkbenchStoryPath = `/__visual/${visualWorkbenchStoryId}`;",
            "const port = resolvePort();",
          ]
          : [
            "const port = Number(process.env.PORT || 3000);",
          ]),
        "const startedAt = new Date().toISOString();",
        "",
        "const server = http.createServer((req, res) => {",
        '  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);',
        "",
        '  if (url.pathname === "/health") {',
        '    res.writeHead(200, { "Content-Type": "application/json" });',
        "    res.end(JSON.stringify({ ok: true, startedAt }));",
        "    return;",
        "  }",
        "",
        ...(includeVisualWorkbench
          ? [
            "  if (visualWorkbenchEnabled() && url.pathname === visualWorkbenchStoryPath) {",
            '    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });',
            "    res.end(`<!doctype html>",
            '<html lang="en">',
            "<head>",
            '  <meta charset="utf-8" />',
            '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
            "  <title>${escapeHtml(projectTitle)} - Visual Workbench</title>",
            "  <style>",
            "    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }",
            "    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: Canvas; color: CanvasText; }",
            "    section { width: min(640px, 100%); border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; padding: 24px; }",
            "    h1 { font-size: 28px; margin: 0 0 8px; }",
            "    p { font-size: 16px; line-height: 1.5; margin: 0; opacity: 0.78; }",
            "    code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }",
            "  </style>",
            "</head>",
            "<body>",
            '  <section data-story-id="${visualWorkbenchStoryId}">',
            "    <h1>${escapeHtml(projectTitle)}</h1>",
            "    <p>Managed starter Visual Workbench story. Replace this with source-owned stories for the requested UI features, widgets and states.</p>",
            "    <p><code>visual-workbench/manifest.json</code></p>",
            "  </section>",
            "</body>",
            "</html>`);",
            "    return;",
            "  }",
            "",
          ]
          : []),
        '  if (url.pathname === "/") {',
        '    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });',
        "    res.end(`<!doctype html>",
        '<html lang="en">',
        "<head>",
        '  <meta charset="utf-8" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
        "  <title>${escapeHtml(projectTitle)}</title>",
        "  <style>",
        "    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }",
        "    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; }",
        "    main { max-width: 720px; }",
        "    h1 { font-size: clamp(28px, 6vw, 56px); margin: 0 0 12px; }",
        "    p { font-size: 18px; line-height: 1.5; margin: 0; opacity: 0.76; }",
        "  </style>",
        "</head>",
        "<body>",
        "  <main>",
        "    <h1>${escapeHtml(projectTitle)}</h1>",
        "    <p>This managed project is ready for Ralph to replace with the requested app.</p>",
        "  </main>",
        "</body>",
        "</html>`);",
        "    return;",
        "  }",
        "",
        '  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });',
        '  res.end("Not found");',
        "});",
        "",
        "server.listen(port, host, () => {",
        '  console.log(`Managed starter listening on http://${host}:${port}`);',
        "});",
        "",
        ...(includeVisualWorkbench
          ? [
            "function resolvePort() {",
            "  const explicitPort = Number(process.env.PORT || 0);",
            "  if (Number.isInteger(explicitPort) && explicitPort > 0) return explicitPort;",
            "  if (visualWorkbenchBaseUrl) {",
            "    try {",
            "      const parsed = new URL(visualWorkbenchBaseUrl);",
            "      const parsedPort = Number(parsed.port || 0);",
            "      if (Number.isInteger(parsedPort) && parsedPort > 0) return parsedPort;",
            "    } catch {",
            "      // Keep the starter deterministic; invalid operator input falls back to default local port.",
            "    }",
            "  }",
            "  return 3000;",
            "}",
            "",
            "function visualWorkbenchEnabled() {",
            "  return Boolean(visualWorkbenchBaseUrl);",
            "}",
            "",
          ]
          : []),
        "function escapeHtml(value) {",
        "  return String(value)",
        '    .replaceAll("&", "&amp;")',
        '    .replaceAll("<", "&lt;")',
        '    .replaceAll(">", "&gt;")',
        '    .replaceAll("\\"", "&quot;");',
        "}",
        "",
      ].join("\n"),
    },
  ];
  if (includeVisualWorkbench) {
    files.push(
      {
        path: VISUAL_WORKBENCH_MANIFEST_PATH,
        content: `${JSON.stringify(visualWorkbenchManifest, null, 2)}\n`,
      },
      {
        path: "visual-workbench/README.md",
        content: [
          "# Visual Workbench",
          "",
          "This source-owned workbench is the starting point for isolated UI render recipes.",
          "When Ralph changes ordinary DOM/web UI, update `visual-workbench/manifest.json`",
          "and add or update stories under `visual-workbench/stories/` for the affected",
          "features, widgets and important states.",
          "",
          "Capture/export remains explicit operator or Ralph tooling work; these files are",
          "not proof, lifecycle state or task completion by themselves.",
          "",
        ].join("\n"),
      },
      {
        path: "visual-workbench/stories/managed-starter.ready.md",
        content: [
          "# managed-starter.ready",
          "",
          "- Feature: managed-starter",
          "- Widget: StarterPage",
          "- State: ready",
          "- Route: `/__visual/managed-starter.ready`",
          "",
          "Replace this starter story with project-specific source-owned render recipes as",
          "the app takes shape.",
          "",
        ].join("\n"),
      },
    );
  }
  return files;
}

function encodeGithubContentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function githubApi<T>(
  method: string,
  endpoint: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`GitHub API ${method} ${endpoint}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : ({} as T);
}
