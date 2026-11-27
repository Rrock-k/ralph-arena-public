#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const templatePath = "infra/governance-rollout/Caddyfile.active-upstream.tpl";
const allowedSlotIds = new Set(["blue", "green"]);

export function renderActiveUpstreamCaddy(options) {
  const slotId = normalizeSlotId(options.slotId);
  const upstream = normalizeUpstream(options.upstream);
  const siteAddress = normalizeSiteAddress(options.siteAddress ?? ":3000");
  const template = options.template ?? fs.readFileSync(path.join(repoRoot, templatePath), "utf8");

  return template
    .replaceAll("__SITE_ADDRESS__", siteAddress)
    .replaceAll("__SLOT_ID__", slotId)
    .replaceAll("__UPSTREAM__", upstream);
}

export function normalizeSlotId(slotId) {
  const normalized = `${slotId ?? ""}`.trim();
  if (!allowedSlotIds.has(normalized)) {
    throw new Error(`slot must be one of: ${[...allowedSlotIds].join(", ")}`);
  }
  return normalized;
}

export function normalizeUpstream(upstream) {
  const normalized = `${upstream ?? ""}`.trim();
  if (!normalized) {
    throw new Error("upstream is required");
  }

  const urlCandidate = normalized.includes("://") ? normalized : `http://${normalized}`;
  let parsed;
  try {
    parsed = new URL(urlCandidate);
  } catch {
    throw new Error(`invalid upstream: ${upstream}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("upstream must use http or https");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("upstream must be an origin only, without path, query or hash");
  }
  if (!parsed.port) {
    throw new Error("upstream must include an explicit port");
  }

  return normalized.includes("://") ? parsed.origin : `${parsed.hostname}:${parsed.port}`;
}

export function normalizeSiteAddress(siteAddress) {
  const normalized = `${siteAddress ?? ""}`.trim();
  if (!normalized) {
    throw new Error("site address is required");
  }
  if (normalized.includes("\n") || normalized.includes("{") || normalized.includes("}")) {
    throw new Error("site address contains unsupported characters");
  }
  return normalized;
}

function parseArgs(argv) {
  const parsed = {
    slotId: null,
    upstream: null,
    siteAddress: ":3000",
    outPath: null,
    print: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--slot") {
      parsed.slotId = argv[++index];
    } else if (arg === "--upstream") {
      parsed.upstream = argv[++index];
    } else if (arg === "--site-address") {
      parsed.siteAddress = argv[++index];
    } else if (arg === "--out") {
      parsed.outPath = argv[++index];
    } else if (arg === "--print") {
      parsed.print = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/governance-rollout-router-config.mjs --slot <blue|green> --upstream <host:port|http-url> [options]

Options:
  --site-address <addr>  Caddy site address to render. Default: :3000
  --out <path>           Write rendered Caddyfile to path.
  --print                Print rendered Caddyfile to stdout.
`);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }

    const rendered = renderActiveUpstreamCaddy({
      slotId: args.slotId,
      upstream: args.upstream,
      siteAddress: args.siteAddress,
    });

    if (args.outPath) {
      const absoluteOutPath = path.resolve(repoRoot, args.outPath);
      fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
      fs.writeFileSync(absoluteOutPath, rendered);
    }
    if (args.print || !args.outPath) {
      process.stdout.write(rendered);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main();
}
