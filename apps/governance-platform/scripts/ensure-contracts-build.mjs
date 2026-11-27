import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(__dirname, "../../../packages/contracts");
const contractsSrcDir = path.join(contractsDir, "src");
const contractsNodeModules = path.join(contractsDir, "node_modules");
const contractsDistEntry = path.join(contractsDir, "dist/index.js");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: contractsDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function newestSourceMtimeMs(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtimeMs(fullPath));
      continue;
    }
    newest = Math.max(newest, statSync(fullPath).mtimeMs);
  }
  return newest;
}

if (!existsSync(contractsNodeModules)) {
  run("npm", ["install", "--no-package-lock", "--ignore-scripts"]);
}

const needsBuild = !existsSync(contractsDistEntry)
  || statSync(contractsDistEntry).mtimeMs < newestSourceMtimeMs(contractsSrcDir);

if (needsBuild) {
  run("npm", ["run", "build"]);
}
