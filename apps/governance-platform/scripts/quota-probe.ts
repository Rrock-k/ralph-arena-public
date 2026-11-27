import { providerQuotaDisplayName, quotaSourceDisplayName } from "../src/lib/provider-quota-display";
import { fetchProviderQuotaSnapshot } from "../src/lib/provider-quotas";

type ProbeTarget = "all" | "claude" | "codex";

function parseArgs(argv: string[]): { json: boolean; target: ProbeTarget } {
  let target: ProbeTarget = "all";
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "all" || arg === "claude" || arg === "codex") {
      target = arg;
    }
  }

  return { json, target };
}

function filterResults(target: ProbeTarget, results: Awaited<ReturnType<typeof fetchProviderQuotaSnapshot>>["results"]) {
  if (target === "claude") return results.filter((result) => result.provider === "anthropic");
  if (target === "codex") return results.filter((result) => result.provider === "openai");
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await fetchProviderQuotaSnapshot();
  const results = filterResults(args.target, snapshot.results);
  const ok = results.some((result) => result.ok);

  if (args.json || process.stdout.isTTY === false) {
    console.log(JSON.stringify({ ok, generatedAt: snapshot.generatedAt, results }, null, 2));
  } else {
    console.log(`generatedAt: ${snapshot.generatedAt}`);
    for (const result of results) {
      console.log(`\n${providerQuotaDisplayName(result.provider)} (${result.provider})`);
      console.log(`  status: ${result.ok ? "ok" : "error"}`);
      console.log(`  source: ${quotaSourceDisplayName(result.source)}`);
      if (!result.ok) {
        console.log(`  error: ${result.error ?? "unknown"}`);
        continue;
      }
      if (result.windows.length === 0) {
        console.log("  windows: none");
        continue;
      }
      for (const window of result.windows) {
        const usageLabel = window.valueLabel ?? (window.usedPercent != null ? `${window.usedPercent}%` : "n/a");
        const resetLabel = window.resetsAt ?? "n/a";
        const detailLabel = window.detail ? ` · ${window.detail}` : "";
        console.log(`  - ${window.label}: ${usageLabel} · reset ${resetLabel}${detailLabel}`);
      }
    }
  }

  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
