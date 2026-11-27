# Loop Testing

> How to test loops through the supported platform path.

## 1. Integration Test

Create a project with a small spec and the loop version under test.

1. Register the loop in the admin panel (`AgentLoop` + `AgentLoopVersion`).
2. Create a proposal with a simple spec, for example "Create a hello world Next.js app".
3. Launch with the loop version selected.
4. Watch logs and progress in the UI.
5. Verify terminal state, preview health and declared capabilities.

The planned "Test loop version" admin shortcut is not a supported current path.
Until it exists, use the full platform launch path above.

## 2. Contract Compliance Checklist

Before publishing a loop version, verify:

- [ ] Reads specs from `$ARENA_SPEC_DIR`.
- [ ] Writes progress to `.arena/progress.json` with valid JSON and supported `state` values.
- [ ] Writes terminal result to `.arena/result.json`.
- [ ] Writes `{"status":"CANCELED","pauseReason":"RATE_LIMIT","retryAt":"..."}`
  for provider quota/rate-limit pauses when the provider exposes reset time.
- [ ] Writes structured `CANCELED + pauseReason` artifacts for recoverable
  `MANUAL`, `BUDGET`, `SECRETS`, `INFRA` and `API` pauses where the loop owns
  that detection.
- [ ] Does not rely on runner-side provider quota inference after an
  unstructured non-zero exit; no `result.json` means generic failure unless
  runner independently classifies auth freshness or API reachability.
- [ ] Exits 0 on successful completion.
- [ ] Does not listen on port 3000.
- [ ] Does not contact governance directly.
- [ ] Handles SIGTERM gracefully.
- [ ] If `community_qa` capability is declared: writes to `.arena/outgoing-events.json` and reads `.arena/events.json`.
