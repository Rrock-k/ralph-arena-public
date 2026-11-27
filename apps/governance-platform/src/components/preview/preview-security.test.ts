import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const RAW_IFRAME_EXCEPTIONS = new Set(["components/preview/PreviewIframe.tsx"]);

function walkTsxFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === "generated" || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsxFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith(".tsx") && !fullPath.endsWith(".stories.tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("preview iframe security guard", () => {
  it("keeps runtime preview embeds behind the shared PreviewIframe component", () => {
    const offenders = walkTsxFiles(SRC_ROOT)
      .map((filePath) => relative(SRC_ROOT, filePath))
      .filter((relativePath) => {
        const contents = readFileSync(join(SRC_ROOT, relativePath), "utf8");
        return contents.includes("<iframe") && !RAW_IFRAME_EXCEPTIONS.has(relativePath);
      });

    expect(offenders).toEqual([]);
  });

  it("keeps preview open links behind the shared redirect boundary", () => {
    const offenders = walkTsxFiles(SRC_ROOT)
      .map((filePath) => relative(SRC_ROOT, filePath))
      .filter((relativePath) => {
        const contents = readFileSync(join(SRC_ROOT, relativePath), "utf8");
        return /href=\{\s*previewUrl\s*\}/.test(contents);
      });

    expect(offenders).toEqual([]);
  });
});
