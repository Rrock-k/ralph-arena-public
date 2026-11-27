import { loadConfig } from "./config.js";
import { ClaudeOAuthProvider } from "./providers/claude.js";
import { CodexSubscriptionProvider } from "./providers/codex.js";
import { createAuthdServer } from "./server.js";
import { AuthService } from "./service.js";

async function main() {
  const config = loadConfig();
  const service = new AuthService({
    claude: new ClaudeOAuthProvider({
      credentialsPath: config.claudeCredentialsPath,
      probeTimeoutMs: config.probeTimeoutMs,
      refreshCommand: config.claudeRefreshCommand,
    }),
    codex: new CodexSubscriptionProvider({
      authJsonPath: config.codexAuthJsonPath,
      probeTimeoutMs: config.probeTimeoutMs,
      refreshCommand: config.codexRefreshCommand,
    }),
  });

  const server = createAuthdServer({
    service,
    secret: config.secret,
  });

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`[authd] listening on :${config.port}`);
  });

  // Proactive token refresh — keeps tokens alive even when no projects are running.
  // Codex access_token TTL is ~10 days; refresh every 6 hours to stay well ahead of expiry.
  const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
  async function proactiveRefresh() {
    for (const providerId of ["claude", "codex"] as const) {
      try {
        const health = await service.refreshProvider(providerId);
        console.log(`[authd] proactive refresh ${providerId}: ${health.status}`);
      } catch (error) {
        console.warn(`[authd] proactive refresh ${providerId} failed:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  // Initial refresh after a short delay (let the server start first)
  setTimeout(proactiveRefresh, 10_000);
  setInterval(proactiveRefresh, REFRESH_INTERVAL_MS);
}

main().catch((error) => {
  console.error("[authd] fatal:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
