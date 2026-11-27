#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredHeaders = [
  'header_down Cache-Control "no-store, no-cache, must-revalidate, max-age=0"',
  'header_down CDN-Cache-Control "no-store"',
  'header_down Cloudflare-CDN-Cache-Control "no-store"',
  'header_down Pragma "no-cache"',
  'header_down Expires "0"',
  'header Cache-Control "no-store, no-cache, must-revalidate, max-age=0"',
  'header CDN-Cache-Control "no-store"',
  'header Cloudflare-CDN-Cache-Control "no-store"',
  'header Pragma "no-cache"',
  'header Expires "0"',
];

const requiredFiles = [
  {
    path: "infra/caddy/Caddyfile",
    importCount: 4,
    responseImportCount: 1,
    fragments: ["reverse_proxy {labels.2}:3999", "reverse_proxy {labels.2}:3000"],
  },
  {
    path: "infra/caddy/Caddyfile.local",
    importCount: 12,
    responseImportCount: 3,
    fragments: [
      "reverse_proxy {labels.1}:3999",
      "reverse_proxy {labels.1}:3000",
      "reverse_proxy {labels.2}:3999",
      "reverse_proxy {labels.2}:3000",
      "reverse_proxy {labels.6}:3999",
      "reverse_proxy {labels.6}:3000",
    ],
  },
  {
    path: "infra/vps/templates/caddy/Caddyfile.tpl",
    importCount: 1,
    responseImportCount: 1,
    fragments: ["reverse_proxy 127.0.0.1:{re.preview_by_port.1}"],
  },
  {
    path: "apps/governance-platform/src/lib/vps/cloud-init.ts",
    importCount: 8,
    responseImportCount: 2,
    fragments: [
      "reverse_proxy {re.container.1}:3999",
      "reverse_proxy {re.container.1}:3000",
      "reverse_proxy {http.request.host.labels.2}:3999",
      "reverse_proxy {http.request.host.labels.2}:3000",
    ],
  },
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

const failures = [];

for (const file of requiredFiles) {
  const content = readRepoFile(file.path);

  for (const header of requiredHeaders) {
    if (!content.includes(header)) {
      failures.push(`${file.path}: missing ${header}`);
    }
  }

  const importCount = countOccurrences(content, "import preview_no_store");
  if (importCount !== file.importCount) {
    failures.push(`${file.path}: expected ${file.importCount} preview_no_store imports, found ${importCount}`);
  }

  const responseImportCount = countOccurrences(content, "import preview_response_no_store");
  if (responseImportCount !== file.responseImportCount) {
    failures.push(`${file.path}: expected ${file.responseImportCount} preview_response_no_store imports, found ${responseImportCount}`);
  }

  for (const fragment of file.fragments) {
    if (!content.includes(fragment)) {
      failures.push(`${file.path}: missing preview route fragment ${fragment}`);
    }
  }
}

const runner = readRepoFile("services/arena-runner/src/preview-service-worker.ts");
for (const headerName of ["CDN-Cache-Control", "Cloudflare-CDN-Cache-Control"]) {
  if (!runner.includes(headerName)) {
    failures.push(`services/arena-runner/src/preview-service-worker.ts: missing ${headerName}`);
  }
}
for (const fragment of ["clearArenaPreviewCaches", "self.caches.keys()", "self.caches.delete(cacheName)"]) {
  if (!runner.includes(fragment)) {
    failures.push(`services/arena-runner/src/preview-service-worker.ts: missing ${fragment}`);
  }
}

if (failures.length > 0) {
  console.error("Preview cache contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Preview cache contract check passed");
