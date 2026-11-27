/**
 * Prisma client for the API proxy.
 * Uses the same database as the governance platform.
 * Follows the same dynamic-import pattern as the dispatcher (runtime.ts:149-166).
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Use a loose type — we only need a subset of the generated client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;

const GOVERNANCE_DIR = path.resolve(
  process.env.GOVERNANCE_DIR ?? path.join(process.cwd(), "..", "..", "apps", "governance-platform")
);

export async function initPrismaClient(): Promise<void> {
  if (prisma) return;

  const clientModulePath = path.join(GOVERNANCE_DIR, "src", "generated", "prisma", "client.ts");
  const { PrismaClient } = (await import(pathToFileURL(clientModulePath).href)) as {
    PrismaClient: new (options?: Record<string, unknown>) => any;
  };

  const governanceRequire = createRequire(path.join(GOVERNANCE_DIR, "package.json"));
  const { PrismaPg } = governanceRequire("@prisma/adapter-pg") as {
    PrismaPg: new (options: { connectionString: string | undefined }) => unknown;
  };

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  prisma = new PrismaClient({ adapter });
  console.log("[api-proxy] Prisma client initialized");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPrisma(): any {
  if (!prisma) throw new Error("Prisma client not initialized. Call initPrismaClient() first.");
  return prisma;
}
