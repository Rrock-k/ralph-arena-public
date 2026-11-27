export type LoopContractMode = "direct" | "ralph";

export const PLATFORM_STAMP_START = "<!-- arena:platform:start -->";
export const PLATFORM_STAMP_END = "<!-- arena:platform:end -->";

export function resolveLoopContractMode(input: {
  agentImpl?: string | null;
  commandTemplate?: string | null;
}): LoopContractMode {
  const agentImpl = input.agentImpl?.trim().toLowerCase();
  if (agentImpl === "ralph") return "ralph";

  const commandTemplate = input.commandTemplate?.trim() ?? "";
  if (commandTemplate.includes("/ralph/") || commandTemplate.includes("ralph-runtime")) {
    return "ralph";
  }

  return "direct";
}

export function buildClaudeMdStamp(mode: LoopContractMode): string {
  const completionRule = mode === "ralph"
    ? "- Completion: Ralph runtime writes `.arena/result.json`; product tasks must finish via the current Ralph prompt, not by editing `.arena/`"
    : [
        '- Completion: write `{"status":"DEPLOYED"}` to `.arena/result.json` and exit 0',
        '- Recoverable provider/auth/quota pauses: write `{"status":"CANCELED","pauseReason":"RATE_LIMIT","retryAt":"..."}` or another valid `pauseReason`; do not rely on runner log/quota guessing',
      ].join("\n");

  const gitRule = mode === "ralph"
    ? "- Git commits are handled by Ralph runtime; focus on product files and tests"
    : "- Commit and push your work to the current branch";

  return `${PLATFORM_STAMP_START}
## Arena Platform Contract

Your app runs on the Arena platform. Read \`.arena/platform.md\` for full runtime rules.

**Key rules:**
- App MUST have \`arena-start.sh\` in the workspace root that starts the application (foreground process)
- App MUST bind to port $PORT (3000) and respond to GET /health with HTTP 200
- Public preview URL is available as \`ARENA_PREVIEW_URL\` when assigned
- Telegram Mini App preview entry URL is available as \`ARENA_TELEGRAM_PREVIEW_URL\` when assigned
- Runtime app data path is \`ARENA_DATA_DIR\` (default \`/data\`); keep SQLite DBs, uploads, generated media, and app caches out of source paths
${completionRule}
- Secrets: read from \`.env.arena-secrets\` or request via \`node /arena/request-secrets.js KEY "description"\`
- NEVER edit files in \`.arena/\` — managed by the platform/runtime
- Store loop-internal state in your own directory, NOT in \`.arena/\`
${gitRule}
${PLATFORM_STAMP_END}`;
}

export function buildPlatformRules(input: {
  mode: LoopContractMode;
  projectId: string;
}): string {
  const completionSection = input.mode === "ralph"
    ? `## Completion

- Ralph runtime owns \`.arena/result.json\` and writes it when the loop reaches a terminal outcome.
- Current product executor tasks MUST NOT write, create, repair, read, or verify \`.arena/result.json\`.
- Product executor tasks finish through the current Ralph prompt completion signal.
- \`progress.json\` is for UI display only — NOT a lifecycle signal.`
    : `## Completion

- Write \`{"status":"DEPLOYED"}\` to \`.arena/result.json\` when done, then exit 0.
- On failure: write \`{"status":"FAILED","reason":"..."}\` to \`.arena/result.json\`.
- On recoverable pauses: write \`{"status":"CANCELED","pauseReason":"RATE_LIMIT","retryAt":"..."}\` or another valid \`pauseReason\` before exiting.
- Valid \`pauseReason\` values: \`MANUAL\`, \`BUDGET\`, \`SECRETS\`, \`RATE_LIMIT\`, \`INFRA\`, \`API\`.
- Provider quota/rate-limit pauses must be reported through \`.arena/result.json\`; runner does not infer \`RATE_LIMIT\` from provider quota probes after an unstructured crash.
- \`progress.json\` is for UI display only — NOT a lifecycle signal.`;

  const arenaDirectorySection = input.mode === "ralph"
    ? `## .arena/ directory

- \`.arena/\` is the platform ↔ loop communication channel.
- Ralph runtime, not product executor tasks, owns lifecycle writes such as \`result.json\`, \`progress.json\`, and \`outgoing-events.json\`.
- Product executor tasks treat \`.arena/platform.md\`, \`.arena/events.json\`, \`.arena/auth.json\`, \`.arena/stop-request.json\`, \`.arena/spec-input.json\`, and other \`.arena/\` files as read-only platform inputs.
- NEVER write anything into \`.arena/\` from product work — use normal project files for the app itself.
- Preview bootstrap lives at \`arena-start.sh\` in the workspace root.`
    : `## .arena/ directory

- \`.arena/\` is the platform ↔ loop communication channel.
- Loop writes: \`result.json\`, \`progress.json\`, \`outgoing-events.json\`
- Loop reads: \`platform.md\`, \`events.json\`, \`auth.json\`, \`stop-request.json\`, \`spec-input.json\`
- NEVER write anything else into \`.arena/\` — use your own directory (e.g. \`.ralph/\`).
- Preview bootstrap lives at \`arena-start.sh\` in the workspace root.`;

  const gitSection = input.mode === "ralph"
    ? `## Git

- Ralph runtime commits task results to the current branch.
- Product executor tasks should edit product files and run relevant checks; they should not create lifecycle-only commits.`
    : `## Git

- Commit and push your work to the current branch.
- Branch name: \`arena/project-${input.projectId}\` (already checked out).`;

  return `# Arena Platform Contract

## Preview / Deployment

- Your app MUST have \`arena-start.sh\` in the workspace root — the ONLY way the platform starts your app.
- \`arena-start.sh\` must be a foreground process (no background daemons).
- It should handle all build steps (install, compile) then start the server.
- App MUST bind to port \`$PORT\` (default 3000).
- App MUST respond to \`GET /health\` with HTTP 200.
- Public preview URL is available in \`ARENA_PREVIEW_URL\` when the platform has assigned one.
- Telegram Mini App preview entry URL is available in \`ARENA_TELEGRAM_PREVIEW_URL\` when the platform has assigned one.

## Runtime Data

- \`/workspace\` is source code plus tracked project truth.
- \`ARENA_DATA_DIR\` is the canonical app runtime data directory; the platform
  mounts it at \`/data\`.
- Put SQLite databases, uploads, generated videos/media, thumbnails, app cache,
  temporary user artifacts, and similar runtime data under \`ARENA_DATA_DIR\`.
- Do not put runtime data in source directories such as \`generated/\`,
  \`uploads/\`, \`cache/\`, or \`data/\` under \`/workspace\` unless the spec
  explicitly requires those files as source fixtures.
- Unknown dirty files in \`/workspace\` block restore/recreate; the runner will
  not delete them to make git sync pass.

${completionSection}

## Secrets

- Available secrets: \`.env.arena-secrets\` (auto-loaded by platform).
- Request missing secrets: \`node /arena/request-secrets.js SECRET_KEY "description"\`
- Add \`--non-blocking\` for optional secrets.

${arenaDirectorySection}

${gitSection}
`;
}
