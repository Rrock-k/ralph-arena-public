import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthdOperatorDigest } from "./authd-operator-digest.js";

test("buildAuthdOperatorDigest reports clean when requested provider is ready", () => {
  const digest = buildAuthdOperatorDigest({
    provider: "codex",
    health: {
      configured: true,
      available: true,
      ok: true,
      providers: {
        codex: {
          provider: "codex",
          source: "codex-auth-json",
          status: "ready",
          version: "codex-version",
          checkedAt: "2026-06-11T07:00:00.000Z",
          detail: null,
          metadata: {
            accessTokenExpiresAt: "2026-06-12T07:00:00.000Z",
          },
        },
      },
    },
  });

  assert.equal(digest.status, "clean");
  assert.equal(digest.action.required, false);
  assert.equal(digest.action.command, null);
  assert.equal(digest.providerHealth?.status, "ready");
  assert.match(digest.operatorDigest, /status: clean/);
  assert.doesNotMatch(digest.operatorDigest, /accessTokenExpiresAt|codex-version/);
});

test("buildAuthdOperatorDigest asks for Codex device auth when provider is missing", () => {
  const digest = buildAuthdOperatorDigest({
    provider: "codex",
    health: {
      configured: true,
      available: true,
      ok: true,
      providers: {
        codex: {
          provider: "codex",
          source: "codex-auth-json",
          status: "missing",
          version: null,
          checkedAt: "2026-06-11T07:00:00.000Z",
          detail: "Codex auth.json is missing or empty.",
        },
      },
    },
  });

  assert.equal(digest.status, "needs_attention");
  assert.equal(digest.action.required, true);
  assert.equal(digest.action.command, "docker exec -it agents-arena-authd-1 codex login --device-auth");
  assert.match(digest.operatorDigest, /codex login --device-auth/);
  assert.match(digest.operatorDigest, /delivery layer should only deliver this digest/);
  assert.doesNotMatch(digest.operatorDigest, /arena-bot/);
});

test("buildAuthdOperatorDigest blocks when authd health is unavailable", () => {
  const digest = buildAuthdOperatorDigest({
    provider: "codex",
    health: {
      configured: true,
      available: false,
      ok: false,
      error: "connect ECONNREFUSED 127.0.0.1:4311",
      providers: {},
    },
  });

  assert.equal(digest.status, "blocked");
  assert.equal(digest.action.required, true);
  assert.equal(digest.action.command, "./scripts/docker-local-stack.sh up -d authd");
  assert.equal(digest.providerHealth, null);
  assert.match(digest.operatorDigest, /authd codex: unavailable/);
});

test("buildAuthdOperatorDigest does not inspect unrelated providers", () => {
  const digest = buildAuthdOperatorDigest({
    provider: "codex",
    health: {
      configured: true,
      available: true,
      ok: true,
      providers: {
        codex: {
          provider: "codex",
          source: "codex-auth-json",
          status: "ready",
          version: null,
          checkedAt: null,
          detail: null,
        },
        claude: {
          provider: "claude",
          source: "claude-credentials",
          status: "missing",
          version: null,
          checkedAt: null,
          detail: "Claude credentials are missing.",
        },
      },
    },
  });

  assert.equal(digest.status, "clean");
  assert.doesNotMatch(digest.operatorDigest, /claude/i);
});
