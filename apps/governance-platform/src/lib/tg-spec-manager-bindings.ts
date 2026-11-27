import "server-only";

import {
  PROJECT_UPDATE_DELIVERY_TARGET_KIND,
} from "@/lib/project-update-outbox";

const TG_SPEC_BINDING_REQUEST_TIMEOUT_MS = 5_000;

export type TgSpecManagerBindingCandidate = {
  sourceTargetId: string;
  targetKind: string;
  label: string | null;
  channelId: string | null;
  chatId: string | null;
  messageThreadId: string | null;
  topicTitle: string | null;
  channelTitle: string | null;
  channelType: string | null;
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
  state: string;
  boundAt: string | null;
  updatedAt: string | null;
  arenaManagerDeliveryTargetId: string | null;
};

export type TgSpecManagerBindingLookup = {
  configured: boolean;
  candidates: TgSpecManagerBindingCandidate[];
  error: string | null;
};

type TgSpecRequestResult =
  | { ok: true; payload: any }
  | { ok: false; error: string; status: number | null };

function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function tgSpecConfig() {
  const baseUrl = trimToNull(process.env.TG_SPEC_INTERNAL_BASE_URL)?.replace(/\/+$/g, "") ?? null;
  const secret = trimToNull(process.env.ARENA_PUSH_SECRET);
  return {
    baseUrl,
    secret,
    configured: Boolean(baseUrl && secret),
  };
}

function normalizeCandidate(value: any): TgSpecManagerBindingCandidate | null {
  const sourceTargetId = trimToNull(value?.sourceTargetId);
  if (!sourceTargetId) return null;

  return {
    sourceTargetId,
    targetKind: trimToNull(value?.targetKind) ?? PROJECT_UPDATE_DELIVERY_TARGET_KIND,
    label: trimToNull(value?.label),
    channelId: trimToNull(value?.channelId),
    chatId: trimToNull(value?.chatId),
    messageThreadId: trimToNull(value?.messageThreadId),
    topicTitle: trimToNull(value?.topicTitle),
    channelTitle: trimToNull(value?.channelTitle),
    channelType: trimToNull(value?.channelType),
    projectId: trimToNull(value?.projectId),
    projectSlug: trimToNull(value?.projectSlug),
    projectTitle: trimToNull(value?.projectTitle),
    state: trimToNull(value?.state) ?? "bound",
    boundAt: trimToNull(value?.boundAt),
    updatedAt: trimToNull(value?.updatedAt),
    arenaManagerDeliveryTargetId: trimToNull(value?.arenaManagerDeliveryTargetId),
  };
}

async function requestTgSpec(path: string, init: RequestInit = {}): Promise<TgSpecRequestResult> {
  const config = tgSpecConfig();
  if (!config.configured || !config.baseUrl || !config.secret) {
    return {
      ok: false,
      error: "tg-spec internal bridge is not configured",
      status: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TG_SPEC_BINDING_REQUEST_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set("x-evolution-push-secret", config.secret);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof payload?.error === "string"
          ? payload.error
          : `tg-spec request failed with ${response.status}`,
      };
    }
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "tg-spec request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listTgSpecManagerBindingCandidates(
  projectId: string,
): Promise<TgSpecManagerBindingLookup> {
  const config = tgSpecConfig();
  if (!config.configured) {
    return {
      configured: false,
      candidates: [],
      error: "tg-spec internal bridge is not configured",
    };
  }

  const result = await requestTgSpec(
    `/api/internal/arena/projects/${encodeURIComponent(projectId)}/telegram-bindings`,
  );
  if (!result.ok) {
    if (result.status === 404) {
      return {
        configured: true,
        candidates: [],
        error: null,
      };
    }
    return {
      configured: true,
      candidates: [],
      error: result.error,
    };
  }

  const candidates = Array.isArray(result.payload?.bindings)
    ? result.payload.bindings
      .map(normalizeCandidate)
      .filter((candidate: TgSpecManagerBindingCandidate | null): candidate is TgSpecManagerBindingCandidate => Boolean(candidate))
    : [];

  return {
    configured: true,
    candidates,
    error: null,
  };
}

export function findTgSpecManagerBindingCandidate(
  lookup: TgSpecManagerBindingLookup,
  sourceTargetId: string,
) {
  const normalized = trimToNull(sourceTargetId);
  if (!normalized) return null;
  return lookup.candidates.find((candidate) => candidate.sourceTargetId === normalized) ?? null;
}

export async function syncTgSpecManagerDeliveryTarget(
  projectId: string,
  sourceTargetId: string,
  targetId: string | null,
) {
  const result = await requestTgSpec(
    `/api/internal/arena/projects/${encodeURIComponent(projectId)}/telegram-bindings`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sourceTargetId,
        targetId,
      }),
    },
  );

  if (!result.ok) {
    return {
      success: false as const,
      error: result.error,
    };
  }

  return {
    success: true as const,
    binding: normalizeCandidate(result.payload?.binding),
  };
}
