# Loops

A **loop** is a program that runs inside an Arena container and drives an AI agent to complete a task. The runner (PID 1) manages the container lifecycle; the loop manages the agent.

Built-in loops: `direct` (single-pass agent) and `ralph` (multi-iteration with planning). Test stubs live in tests and fixtures, not as a supported production loop.

External loops can be loaded from git — see [contract](contract.md) section 13.

## Contents

- [contract.md](contract.md) — Runner ↔ Loop contract (env vars, `.arena/` channels, capabilities, completion signals)
- [testing.md](testing.md) — How to test loops locally and through the platform
