import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import path from "path";

type MaterializeStartScriptDeps = {
  existsSync?: (filePath: string) => boolean;
  mkdirSync?: (dirPath: string, options: { recursive: boolean }) => void;
  readFileSync?: (filePath: string, encoding: "utf8") => string;
  writeFileSync?: (filePath: string, contents: string, options?: { mode?: number }) => void;
  chmodSync?: (filePath: string, mode: number) => void;
};

export function materializeBundledRalphStartScript(
  workspacePath: string,
  templatePath: string,
  deps: MaterializeStartScriptDeps = {},
): boolean {
  const fileExists = deps.existsSync ?? existsSync;
  const ensureDir = deps.mkdirSync ?? mkdirSync;
  const readText = deps.readFileSync ?? readFileSync;
  const writeText = deps.writeFileSync ?? writeFileSync;
  const chmod = deps.chmodSync ?? chmodSync;

  const startScriptPath = path.join(workspacePath, "arena-start.sh");
  if (fileExists(startScriptPath)) {
    return false;
  }

  if (!fileExists(templatePath)) {
    throw new Error(`bundled Ralph runtime start script template missing: ${templatePath}`);
  }

  const contents = readText(templatePath, "utf8");
  writeText(startScriptPath, contents, { mode: 0o755 });
  chmod(startScriptPath, 0o755);
  return true;
}
