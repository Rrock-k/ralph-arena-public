import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  propagateAttributes,
  LangfuseOtelSpanAttributes,
  setLangfuseTracerProvider,
  startActiveObservation,
  type LangfuseGenerationAttributes,
} from '@langfuse/tracing';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { PromptTraceEvent, PromptTraceContextValue } from './trace.js';

const LANGFUSE_DEFAULT_TIMEOUT_MS = 1500;
const LANGFUSE_PAYLOAD_SCHEMA_VERSION = 'ra-312.langfuse-sdk-prompt-call.v1' as const;
const LANGFUSE_TRACE_TAGS = ['ralph', 'prompt-call'] as const;

export interface LangfuseMirrorConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

export type LangfuseMirrorResult =
  | { status: 'disabled'; reason: 'missing_env' }
  | { status: 'sent' }
  | { status: 'failed'; reason: string };

interface MirrorPromptTraceOptions {
  config?: LangfuseMirrorConfig | null;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  client?: LangfuseMirrorClient;
}

interface LangfuseMirrorClient {
  recordGeneration(
    name: string,
    attributes: LangfuseGenerationAttributes,
    traceAttributes: LangfuseTraceMirrorAttributes,
  ): void;
  forceFlush(): Promise<void>;
}

interface LangfuseTraceMirrorAttributes {
  name: string;
  tags: string[];
  metadata: Record<string, string>;
}

let cachedClientKey: string | null = null;
let cachedClient: LangfuseMirrorClient | null = null;

export function readLangfuseMirrorConfig(
  env: NodeJS.ProcessEnv = process.env,
): LangfuseMirrorConfig | null {
  const baseUrl = normalizeBaseUrl(env.LANGFUSE_BASE_URL);
  const publicKey = trimToNull(env.LANGFUSE_PUBLIC_KEY);
  const secretKey = trimToNull(env.LANGFUSE_SECRET_KEY);

  if (!baseUrl || !publicKey || !secretKey) {
    return null;
  }

  return { baseUrl, publicKey, secretKey };
}

export function buildLangfuseGenerationAttributes(
  event: PromptTraceEvent,
): LangfuseGenerationAttributes {
  return {
    ...(event.model ? { model: event.model } : {}),
    input: event.prompt.text,
    output: event.output.text,
    level: event.success ? 'DEFAULT' : 'ERROR',
    ...(!event.success ? { statusMessage: event.parse.summary ?? 'Ralph prompt call failed' } : {}),
    ...(event.usage ? {
      usageDetails: {
        input: event.usage.inputTokens,
        output: event.usage.outputTokens,
        total: event.usage.totalTokens,
      },
    } : {}),
    metadata: buildRalphMetadata(event),
  };
}

export async function mirrorPromptTraceEventToLangfuse(
  event: PromptTraceEvent,
  options: MirrorPromptTraceOptions = {},
): Promise<LangfuseMirrorResult> {
  const config = options.config === undefined
    ? readLangfuseMirrorConfig(options.env ?? process.env)
    : options.config;
  if (!config) {
    return { status: 'disabled', reason: 'missing_env' };
  }

  const timeoutMs = options.timeoutMs ?? LANGFUSE_DEFAULT_TIMEOUT_MS;
  const client = options.client ?? getOrCreateLangfuseClient(config, timeoutMs);
  const traceAttributes = buildLangfuseTraceAttributes(event);

  try {
    propagateAttributes(
      {
        traceName: traceAttributes.name,
        tags: traceAttributes.tags,
        metadata: traceAttributes.metadata,
      },
      () => {
        client.recordGeneration(
          event.promptId,
          buildLangfuseGenerationAttributes(event),
          traceAttributes,
        );
      },
    );

    await withTimeout(client.forceFlush(), timeoutMs);
    return { status: 'sent' };
  } catch (error) {
    const reason = error instanceof Error && error.message === 'langfuse_timeout'
      ? 'timeout'
      : 'request_failed';
    return { status: 'failed', reason };
  }
}

function getOrCreateLangfuseClient(
  config: LangfuseMirrorConfig,
  timeoutMs: number,
): LangfuseMirrorClient {
  const key = `${config.baseUrl}\n${config.publicKey}`;
  if (cachedClient && cachedClientKey === key) return cachedClient;

  const processor = new LangfuseSpanProcessor({
    baseUrl: config.baseUrl,
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    exportMode: 'immediate',
    flushAt: 1,
    timeout: timeoutMs / 1000,
  });
  const provider = new NodeTracerProvider({
    spanProcessors: [processor],
  });
  setLangfuseTracerProvider(provider);

  cachedClientKey = key;
  cachedClient = {
    recordGeneration: (name, attributes, traceAttributes) => {
      startActiveObservation(
        name,
        (generation) => {
          generation.otelSpan.setAttributes({
            [LangfuseOtelSpanAttributes.TRACE_NAME]: traceAttributes.name,
            [LangfuseOtelSpanAttributes.TRACE_TAGS]: traceAttributes.tags,
            ...Object.fromEntries(
              Object.entries(traceAttributes.metadata).map(([metadataKey, value]) => [
                `${LangfuseOtelSpanAttributes.TRACE_METADATA}.${metadataKey}`,
                value,
              ]),
            ),
          });
          generation.update(attributes);
        },
        { asType: 'generation' },
      );
    },
    forceFlush: () => processor.forceFlush(),
  };

  return cachedClient;
}

function buildLangfuseTraceAttributes(event: PromptTraceEvent): LangfuseTraceMirrorAttributes {
  return {
    name: event.label,
    tags: [...LANGFUSE_TRACE_TAGS],
    metadata: {
      source: 'ralph-runtime',
      schemaVersion: LANGFUSE_PAYLOAD_SCHEMA_VERSION,
      eventId: event.eventId,
      promptId: event.promptId,
      owner: event.owner,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('langfuse_timeout')), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildRalphMetadata(event: PromptTraceEvent): Record<string, unknown> {
  return {
    ralph: {
      schemaVersion: event.schemaVersion,
      eventType: event.eventType,
      eventId: event.eventId,
      promptId: event.promptId,
      owner: event.owner,
      label: event.label,
      success: event.success,
      parseStatus: event.parse.status,
      ...(event.parse.summary ? { parseSummary: event.parse.summary } : {}),
      promptCharCount: event.prompt.charCount,
      outputCharCount: event.output.charCount,
      ...(event.usage ? {
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        totalTokens: event.usage.totalTokens,
        apiEquivalentCostUsd: event.usage.apiEquivalentCostUsd,
        pricingSource: event.usage.pricingSource,
      } : {}),
    },
    context: compactContext(event.context),
  };
}

function compactContext(
  context: Record<string, PromptTraceContextValue>,
): Record<string, PromptTraceContextValue> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as Record<string, PromptTraceContextValue>;
}
