const PROXY_AUTH_SENTINEL = "arena-proxy";

export function resolveApiProxyUrlForBackend(backend: string | null | undefined): string {
  const normalizedBackend = backend === "vps" ? "vps" : "local";
  if (normalizedBackend === "vps") {
    return process.env.API_PROXY_PUBLIC_URL || process.env.API_PROXY_URL || "http://api-proxy:4100";
  }
  return process.env.API_PROXY_URL || "http://api-proxy:4100";
}

export function buildProviderProxyAuthEnv(input: {
  projectId: string;
  agent: string;
  apiProxyUrl: string;
}): Record<string, string> {
  const proxyBase = input.apiProxyUrl.replace(/\/$/, "");

  if (input.agent === "codex") {
    const openaiBaseUrl = `${proxyBase}/openai/project/${input.projectId}`;
    return {
      OPENAI_API_KEY: PROXY_AUTH_SENTINEL,
      OPENAI_BASE_URL: openaiBaseUrl,
      OPENAI_API_BASE: openaiBaseUrl,
    };
  }

  if (input.agent === "claude-code") {
    const anthropicBaseUrl = `${proxyBase}/anthropic/project/${input.projectId}`;
    return {
      ANTHROPIC_API_KEY: PROXY_AUTH_SENTINEL,
      ANTHROPIC_BASE_URL: anthropicBaseUrl,
      ANTHROPIC_API_URL: anthropicBaseUrl,
    };
  }

  return {};
}
