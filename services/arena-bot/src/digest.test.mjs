import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  extractLatestOperatorDigest,
  extractLatestOperatorDigestEntry,
  loadSentState,
  parseSourceFiles,
  runAllSourcesOnce,
  runOnce,
} from "./digest.mjs";
import { resolveDigestSourceFiles } from "./index.mjs";

test("extractLatestOperatorDigest returns the latest digest verbatim", () => {
  const markdown = [
    "# Ralph weekly instruction maintenance memory",
    "",
    "## 2026-06-02",
    "",
    "### Operator digest",
    "",
    "- old status",
    "",
    "## 2026-06-09",
    "",
    "### Operator digest",
    "",
    "- status: needs attention",
    "- next: RA-332 owner",
    "",
    "### Other notes",
    "- not part of digest",
  ].join("\n");

  assert.equal(
    extractLatestOperatorDigest(markdown),
    "- status: needs attention\n- next: RA-332 owner",
  );
});

test("extractLatestOperatorDigest returns null when digest is absent", () => {
  assert.equal(extractLatestOperatorDigest("## Run\n- no digest here"), null);
});

test("extractLatestOperatorDigest accepts bullet marker used by automation memory", () => {
  const markdown = [
    "## 2026-06-08",
    "",
    "- Operator digest:",
    "  - status: needs attention",
    "  - next: owner",
  ].join("\n");

  assert.equal(
    extractLatestOperatorDigest(markdown),
    "- status: needs attention\n  - next: owner",
  );
});

test("extractLatestOperatorDigestEntry reads parent run timestamp", () => {
  const markdown = [
    "## 2026-06-08 14:04:09 +04",
    "",
    "- Operator digest:",
    "  - status: clean",
  ].join("\n");

  assert.deepEqual(
    extractLatestOperatorDigestEntry(markdown),
    {
      digest: "- status: clean",
      createdAt: "2026-06-08T10:04:09.000Z",
      createdAtMs: Date.parse("2026-06-08T10:04:09.000Z"),
    },
  );
});

test("extractLatestOperatorDigestEntry reads parent timestamp for heading marker", () => {
  const markdown = [
    "## 2026-06-08 14:04:09 +04",
    "",
    "### Operator digest",
    "",
    "- status: clean",
  ].join("\n");

  assert.deepEqual(
    extractLatestOperatorDigestEntry(markdown),
    {
      digest: "- status: clean",
      createdAt: "2026-06-08T10:04:09.000Z",
      createdAtMs: Date.parse("2026-06-08T10:04:09.000Z"),
    },
  );
});

test("parseSourceFiles reads comma-separated source paths", () => {
  assert.deepEqual(
    parseSourceFiles(" /automation/a.md, /automation/b.md ,,/automation/c.md "),
    ["/automation/a.md", "/automation/b.md", "/automation/c.md"],
  );
});

test("resolveDigestSourceFiles includes auth reminder by default", () => {
  assert.deepEqual(
    resolveDigestSourceFiles({
      configuredSourceFiles: "",
      legacySourceFile: "/automation/memory.md",
    }),
    [
      "/automation/memory.md",
      "/automations/ralph-authd-relogin-reminder/memory.md",
    ],
  );
});

test("resolveDigestSourceFiles lets explicit source list override defaults", () => {
  assert.deepEqual(
    resolveDigestSourceFiles({
      configuredSourceFiles: "/automations/custom-a/memory.md,/automations/custom-b/memory.md",
      legacySourceFile: "/automation/memory.md",
    }),
    [
      "/automations/custom-a/memory.md",
      "/automations/custom-b/memory.md",
    ],
  );
});

test("runOnce does not mark unsent digest when credentials are missing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arena-bot-"));
  try {
    const sourceFile = path.join(dir, "memory.md");
    const stateFile = path.join(dir, "state.json");
    await writeFile(sourceFile, "## Run\n\n### Operator digest\n\n- status: clean\n");

    const result = await runOnce({
      sourceFile,
      stateFile,
      telegramBotToken: "",
      telegramChatId: "",
    });

    assert.equal(result.status, "not_configured");
    assert.deepEqual(loadSentState(stateFile), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runOnce sends once and dedupes by digest hash", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arena-bot-"));
  try {
    const sourceFile = path.join(dir, "memory.md");
    const stateFile = path.join(dir, "state.json");
    await writeFile(sourceFile, "## Run\n\n### Operator digest\n\n- status: clean\n");

    const sent = [];
    const config = {
      sourceFile,
      stateFile,
      telegramBotToken: "token",
      telegramChatId: "chat",
    };

    const first = await runOnce(config, {
      sendMessage: async (message) => {
        sent.push(message.text);
      },
    });
    const second = await runOnce(config, {
      sendMessage: async (message) => {
        sent.push(message.text);
      },
    });

    assert.equal(first.status, "sent");
    assert.equal(second.status, "already_sent");
    assert.deepEqual(sent, ["- status: clean"]);

    const state = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(state.lastDigestHash, first.digestHash);
    assert.equal(state.sources[sourceFile].lastDigestHash, first.digestHash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runOnce skips stale dated digest without sending or marking state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arena-bot-"));
  try {
    const sourceFile = path.join(dir, "memory.md");
    const stateFile = path.join(dir, "state.json");
    await writeFile(sourceFile, [
      "## 2026-06-08 14:04:09 +04",
      "",
      "- Operator digest:",
      "  - status: stale",
    ].join("\n"));

    const sent = [];
    const result = await runOnce({
      sourceFile,
      stateFile,
      telegramBotToken: "token",
      telegramChatId: "chat",
      maxDigestAgeMs: 48 * 60 * 60 * 1000,
    }, {
      now: () => new Date("2026-06-11T08:00:00.000Z"),
      sendMessage: async (message) => {
        sent.push(message.text);
      },
    });

    assert.equal(result.status, "stale_digest");
    assert.equal(result.createdAt, "2026-06-08T10:04:09.000Z");
    assert.deepEqual(sent, []);
    assert.deepEqual(loadSentState(stateFile), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runOnce still sends untimestamped digest when max age is enabled", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arena-bot-"));
  try {
    const sourceFile = path.join(dir, "memory.md");
    const stateFile = path.join(dir, "state.json");
    await writeFile(sourceFile, "### Operator digest\n\n- status: clean\n");

    const sent = [];
    const result = await runOnce({
      sourceFile,
      stateFile,
      telegramBotToken: "token",
      telegramChatId: "chat",
      maxDigestAgeMs: 48 * 60 * 60 * 1000,
    }, {
      now: () => new Date("2026-06-11T08:00:00.000Z"),
      sendMessage: async (message) => {
        sent.push(message.text);
      },
    });

    assert.equal(result.status, "sent");
    assert.deepEqual(sent, ["- status: clean"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runAllSourcesOnce sends each source and dedupes per source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "arena-bot-"));
  try {
    const weeklySource = path.join(dir, "weekly.md");
    const providerSource = path.join(dir, "provider.md");
    const stateFile = path.join(dir, "state.json");
    await writeFile(weeklySource, "## Run\n\n### Operator digest\n\n- status: clean\n");
    await writeFile(providerSource, "## Run\n\n### Operator digest\n\n- status: clean\n");

    const sent = [];
    const config = {
      sourceFiles: [weeklySource, providerSource],
      stateFile,
      telegramBotToken: "token",
      telegramChatId: "chat",
    };

    const first = await runAllSourcesOnce(config, {
      sendMessage: async (message) => {
        sent.push(message.text);
      },
    });
    const second = await runAllSourcesOnce(config, {
      sendMessage: async (message) => {
        sent.push(message.text);
      },
    });

    assert.deepEqual(first.map((result) => result.status), ["sent", "sent"]);
    assert.deepEqual(second.map((result) => result.status), ["already_sent", "already_sent"]);
    assert.deepEqual(sent, ["- status: clean", "- status: clean"]);

    const state = JSON.parse(await readFile(stateFile, "utf8"));
    assert.equal(state.sources[weeklySource].lastDigestHash, first[0].digestHash);
    assert.equal(state.sources[providerSource].lastDigestHash, first[1].digestHash);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
