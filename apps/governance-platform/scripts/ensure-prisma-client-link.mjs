import fs from "node:fs";
import path from "node:path";

const appRoot = process.cwd();
const nodeModulesRoot = path.join(appRoot, "node_modules");
const prismaClientDir = path.join(nodeModulesRoot, "@prisma", "client");
const sourceDir = path.join(nodeModulesRoot, ".prisma");
const linkPath = path.join(prismaClientDir, ".prisma");
const generatedRoot = path.join(appRoot, "src", "generated", "prisma");

if (!fs.existsSync(prismaClientDir)) {
  throw new Error(`Missing Prisma client dir: ${prismaClientDir}`);
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Missing generated Prisma payload: ${sourceDir}`);
}

try {
  const existing = fs.lstatSync(linkPath);
  if (existing.isSymbolicLink()) {
    const currentTarget = fs.readlinkSync(linkPath);
    if (currentTarget === "../../.prisma") {
      process.exit(0);
    }
    fs.unlinkSync(linkPath);
  } else {
    fs.rmSync(linkPath, { recursive: true, force: true });
  }
} catch {
  // link does not exist
}

fs.symlinkSync("../../.prisma", linkPath, "dir");

// Keep the legacy repo-local import path stable, but do not leave stale
// prisma-client-generated internals around for Turbopack to discover.
fs.rmSync(generatedRoot, { recursive: true, force: true });
fs.mkdirSync(generatedRoot, { recursive: true });

fs.writeFileSync(
  path.join(generatedRoot, "client.ts"),
  `// Package-backed Prisma client shim.
// Keep the legacy import path stable while routing through @prisma/client.

export * from "@prisma/client";
`,
);

fs.writeFileSync(
  path.join(generatedRoot, "browser.ts"),
  `// Browser-safe Prisma type shim.
// Legacy imports should only use Prisma types and enums here.

export { Prisma } from "@prisma/client";
export type * from "@prisma/client";
`,
);
