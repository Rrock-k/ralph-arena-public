import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type CloneWorkspaceDeps = {
  existsSync?: typeof existsSync;
  mkdirSync?: typeof mkdirSync;
  readFileSync?: typeof readFileSync;
  writeFileSync?: typeof writeFileSync;
  chmodSync?: typeof chmodSync;
  readdirSync?: typeof readdirSync;
  rmSync?: typeof rmSync;
  cloneRepo?: (sourcePath: string, targetPath: string) => void;
};

export function cloneHostRepoIntoWorkspacePreservingBootstrapStartScript(
  hostRepoPath: string,
  workspacePath: string,
  deps: CloneWorkspaceDeps = {},
): void {
  const fileExists = deps.existsSync ?? existsSync;
  const ensureDir = deps.mkdirSync ?? mkdirSync;
  const readText = deps.readFileSync ?? readFileSync;
  const writeText = deps.writeFileSync ?? writeFileSync;
  const chmod = deps.chmodSync ?? chmodSync;
  const readdir = deps.readdirSync ?? readdirSync;
  const remove = deps.rmSync ?? rmSync;
  const cloneRepo = deps.cloneRepo ?? ((sourcePath: string, targetPath: string) => {
    execSync(`git clone ${quote(sourcePath)} ${quote(targetPath)}`, { stdio: "inherit" });
  });

  const bootstrapStartScriptPath = join(workspacePath, "arena-start.sh");
  const bootstrapStartScript = fileExists(bootstrapStartScriptPath)
    ? readText(bootstrapStartScriptPath, "utf8")
    : null;

  clearWorkspaceContents(workspacePath, { ensureDir, readdir, remove });
  cloneRepo(hostRepoPath, workspacePath);

  if (bootstrapStartScript !== null) {
    writeText(bootstrapStartScriptPath, bootstrapStartScript, { mode: 0o755 });
    chmod(bootstrapStartScriptPath, 0o755);
  }
}

function clearWorkspaceContents(
  workspacePath: string,
  deps: {
    ensureDir: typeof mkdirSync;
    readdir: typeof readdirSync;
    remove: typeof rmSync;
  },
): void {
  deps.ensureDir(workspacePath, { recursive: true });
  for (const entry of deps.readdir(workspacePath)) {
    deps.remove(join(workspacePath, entry), { recursive: true, force: true });
  }
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
