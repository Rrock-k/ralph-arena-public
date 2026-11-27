import { existsSync, readFileSync, writeFileSync } from "fs";
import { requestSecrets } from "./api.js";

const WORKSPACE_DIR = process.env.ARENA_WORKSPACE_DIR || "/workspace";
const SECRETS_FILE = `${WORKSPACE_DIR}/.env.arena-secrets`;

function usage(): never {
  console.error("Usage: node /arena/request-secrets.js SECRET_KEY [description] [--non-blocking]");
  process.exit(1);
}

function mergeSecretsFile(provided: Record<string, string>): void {
  const existing = new Map<string, string>();
  if (existsSync(SECRETS_FILE)) {
    for (const line of readFileSync(SECRETS_FILE, "utf-8").split("\n")) {
      const idx = line.indexOf("=");
      if (idx <= 0) continue;
      existing.set(line.slice(0, idx), line.slice(idx + 1));
    }
  }
  for (const [key, value] of Object.entries(provided)) {
    existing.set(key, value);
    process.env[key] = value;
  }
  const nextContent = Array.from(existing.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(SECRETS_FILE, nextContent, { mode: 0o600 });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const nonBlocking = args.includes("--non-blocking");
  const filtered = args.filter((arg) => arg !== "--non-blocking");
  const [key, ...descriptionParts] = filtered;
  if (!key) usage();

  const description = descriptionParts.join(" ").trim() || undefined;
  const result = await requestSecrets([{ key, description, blocking: !nonBlocking }]);

  if (Object.keys(result.provided).length > 0) {
    mergeSecretsFile(result.provided);
  }

  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write("\n");

  if (result.paused) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[request-secrets] Failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
