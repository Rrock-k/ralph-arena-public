import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "fs";
import os from "os";
import path from "path";
import { materializeBundledRalphStartScript } from "./ralph-runtime.js";

test("materializeBundledRalphStartScript writes arena-start.sh from template", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "worker-bundled-ralph-runtime-"));
  const workspace = path.join(root, "workspace");
  const template = path.join(root, "template.sh");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, "package.json"), "{\"name\":\"demo\"}\n");
  writeFileSync(
    template,
    "#!/bin/sh\nset -eu\n\ncd \"$(dirname \"$0\")/../apps/governance-platform\"\n\nif [ ! -f .next/standalone/server.js ]; then\n  npm run build\nfi\n\nexport HOSTNAME=\"${HOSTNAME:-0.0.0.0}\"\nexec npm start\n",
  );

  const created = materializeBundledRalphStartScript(workspace, template);

  assert.equal(created, true);
  const startScriptPath = path.join(workspace, "arena-start.sh");
  assert.equal(existsSync(startScriptPath), true);
  assert.equal(
    readFileSync(startScriptPath, "utf8"),
    "#!/bin/sh\nset -eu\n\ncd \"$(dirname \"$0\")/../apps/governance-platform\"\n\nif [ ! -f .next/standalone/server.js ]; then\n  npm run build\nfi\n\nexport HOSTNAME=\"${HOSTNAME:-0.0.0.0}\"\nexec npm start\n",
  );
  assert.equal((statSync(startScriptPath).mode & 0o111) !== 0, true);
});

test("materializeBundledRalphStartScript does not overwrite an existing arena-start.sh", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "worker-bundled-ralph-runtime-"));
  const workspace = path.join(root, "workspace");
  const template = path.join(root, "template.sh");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(path.join(workspace, "package.json"), "{\"name\":\"demo\"}\n");
  writeFileSync(path.join(workspace, "arena-start.sh"), "#!/bin/sh\nexit 0\n");
  writeFileSync(
    template,
    "#!/bin/sh\nset -eu\n\ncd \"$(dirname \"$0\")/../apps/governance-platform\"\n\nif [ ! -f .next/standalone/server.js ]; then\n  npm run build\nfi\n\nexport HOSTNAME=\"${HOSTNAME:-0.0.0.0}\"\nexec npm start\n",
  );

  const created = materializeBundledRalphStartScript(workspace, template);

  assert.equal(created, false);
  assert.equal(readFileSync(path.join(workspace, "arena-start.sh"), "utf8"), "#!/bin/sh\nexit 0\n");
});
