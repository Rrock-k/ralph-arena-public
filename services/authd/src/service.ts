import { hashPayload } from "./hash.js";
import type {
  AuthProvider,
  MintRunAuthModes,
  MintRunAuthResult,
  ProviderHealth,
  ProviderId,
  ProviderPostMortem,
  ProviderPostMortemInput,
  ProviderQuotaResult,
  ProviderQuotaSnapshot,
} from "./types.js";

export class ProviderNotFoundError extends Error {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`);
  }
}

export class AuthService {
  private readonly providers: Partial<Record<ProviderId, AuthProvider>>;

  constructor(providers: Partial<Record<ProviderId, AuthProvider>>) {
    this.providers = providers;
  }

  async health(): Promise<{ ok: true; providers: Partial<Record<ProviderId, ProviderHealth>> }> {
    const entries = await Promise.all(
      Object.entries(this.providers).map(async ([providerId, provider]) => [
        providerId,
        await provider!.health(),
      ] as const),
    );

    return {
      ok: true,
      providers: Object.fromEntries(entries) as Partial<Record<ProviderId, ProviderHealth>>,
    };
  }

  async getProviderHealth(providerId: string): Promise<ProviderHealth> {
    return this.getProvider(providerId).health();
  }

  async refreshProvider(providerId: string): Promise<ProviderHealth> {
    return this.getProvider(providerId).refresh();
  }

  async getProviderQuota(providerId: string): Promise<ProviderQuotaResult> {
    return this.getProvider(providerId).quota();
  }

  async quotaSnapshot(): Promise<ProviderQuotaSnapshot> {
    const results = await Promise.all(
      Object.values(this.providers).map((provider) => provider!.quota()),
    );

    return {
      generatedAt: new Date().toISOString(),
      results,
    };
  }

  async providerPostMortem(providerId: string, input?: ProviderPostMortemInput): Promise<ProviderPostMortem> {
    return this.getProvider(providerId).postMortem(input);
  }

  async mintRunAuth(modes: MintRunAuthModes): Promise<MintRunAuthResult> {
    const auth: Record<string, string> = {};
    const providers: Partial<Record<ProviderId, ProviderHealth>> = {};

    if ((modes.claudeAuthMode ?? "oauth") === "oauth" && this.providers.claude) {
      const minted = await this.providers.claude.mintRunAuth();
      Object.assign(auth, minted.auth);
      providers.claude = minted.health;
    }

    if ((modes.codexAuthMode ?? "subscription") === "subscription" && this.providers.codex) {
      const minted = await this.providers.codex.mintRunAuth();
      Object.assign(auth, minted.auth);
      providers.codex = minted.health;
    }

    return {
      version: hashPayload(auth),
      auth,
      providers,
    };
  }

  private getProvider(providerId: string): AuthProvider {
    if (providerId === "claude" || providerId === "codex") {
      const provider = this.providers[providerId];
      if (provider) return provider;
    }

    throw new ProviderNotFoundError(providerId);
  }
}
