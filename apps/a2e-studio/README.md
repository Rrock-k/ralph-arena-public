# A2E Studio

Standalone local devtool for Ralph Arena A2E runs.

## Purpose

- choose commit scope explicitly
- shift-select several contiguous commit blocks
- toggle scenarios and execution rules
- attach custom instructions per block
- generate manifest + short prompt
- keep all of this outside governance/admin

Generated files go to:

- `a2e/state/manifests/*.json`
- `a2e/state/manifests/*.prompt.md`

## Run

```bash
npm run a2e:studio
```

Default URL:

- `http://localhost:3003`

## Run In Local Docker Stack

```bash
./scripts/docker-local-stack.sh up -d a2e-studio
```

The local compose service uses a tiny dev image with `git` installed, because the app reads commit history directly from the mounted repos.

If `3003` is already occupied on the host:

```bash
A2E_STUDIO_PORT=3004 ./scripts/docker-local-stack.sh up -d a2e-studio
```
