import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const standaloneDir = resolve(rootDir, ".next/standalone");
const serverCandidates = [
  resolve(standaloneDir, "server.js"),
  resolve(standaloneDir, "apps/governance-platform/server.js"),
];
const serverPath = serverCandidates.find((candidate) => existsSync(candidate)) ?? serverCandidates[0];
const standaloneAppDir = dirname(serverPath);
const dbPath = resolve(rootDir, "dev.db");
const staticSourcePath = resolve(rootDir, ".next/static");
const staticLinkPath = resolve(standaloneAppDir, ".next/static");
const publicSourcePath = resolve(rootDir, "public");
const publicLinkPath = resolve(standaloneAppDir, "public");

if (!existsSync(serverPath)) {
  console.error("Standalone build not found. Run `npm run build` first.");
  process.exit(1);
}

const ensureDirSymlink = (sourcePath, linkPath) => {
  if (!existsSync(sourcePath)) {
    return;
  }

  mkdirSync(dirname(linkPath), { recursive: true });

  try {
    if (existsSync(linkPath)) {
      const stats = lstatSync(linkPath);
      if (stats.isSymbolicLink()) {
        const currentTarget = resolve(dirname(linkPath), readlinkSync(linkPath));
        if (currentTarget === sourcePath) {
          return;
        }
      }
      rmSync(linkPath, { recursive: true, force: true });
    }
  } catch {
    rmSync(linkPath, { recursive: true, force: true });
  }

  symlinkSync(sourcePath, linkPath, "dir");
};

ensureDirSymlink(staticSourcePath, staticLinkPath);
ensureDirSymlink(publicSourcePath, publicLinkPath);

const env = { ...process.env };
if (!env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is required for governance standalone preview. Provide a PostgreSQL connection string.",
  );
  process.exit(1);
}

const child = spawn("node", [serverPath], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
