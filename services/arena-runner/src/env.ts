import { existsSync, readFileSync } from "fs";

export function readEnvFile(envFilePath: string): Record<string, string> {
  if (!existsSync(envFilePath)) return {};

  const env: Record<string, string> = {};
  for (const line of readFileSync(envFilePath, "utf-8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}
