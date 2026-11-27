import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramPreviewEntryUrl } from "./telegram-preview-entry.js";

test("buildTelegramPreviewEntryUrl builds the Arena Telegram preview entry URL from governance origin and project id", () => {
  assert.equal(
    buildTelegramPreviewEntryUrl(
      "https://app.arena.example.test/",
      "project-1",
    ),
    "https://app.arena.example.test/api/auth/telegram-preview-entry?projectId=project-1",
  );
});

test("buildTelegramPreviewEntryUrl encodes project id and rejects malformed or non-public inputs", () => {
  assert.equal(
    buildTelegramPreviewEntryUrl(
      "https://app.arena.example.test",
      "project with spaces",
    ),
    "https://app.arena.example.test/api/auth/telegram-preview-entry?projectId=project+with+spaces",
  );

  assert.equal(buildTelegramPreviewEntryUrl("", "project-1"), "");
  assert.equal(buildTelegramPreviewEntryUrl("not a url", "project-1"), "");
  assert.equal(buildTelegramPreviewEntryUrl("http://app.arena.example.test", "project-1"), "");
  assert.equal(buildTelegramPreviewEntryUrl("http://governance-platform:3000", "project-1"), "");
  assert.equal(buildTelegramPreviewEntryUrl("https://localhost:3000", "project-1"), "");
  assert.equal(buildTelegramPreviewEntryUrl("https://app.arena.example.test", ""), "");
});
