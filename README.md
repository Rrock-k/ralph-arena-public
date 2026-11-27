# Ralph Arena

Ralph Arena coordinates AI coding agents that build applications from project specifications. It combines a governance application, a worker that manages isolated preview containers, and a runner that executes agent loops and reports progress.

## Components

- `apps/governance-platform`: Next.js UI, authentication and control-plane APIs.
- `services/worker-agent`: claims runtime intents and manages preview containers.
- `services/arena-runner`: initializes project workspaces and runs agents in preview containers.
- `services/authd` and `services/api-proxy`: local authentication authority and provider proxy.
- `packages/contracts` and `packages/loops/ralph-runtime`: shared interfaces and the bundled Ralph loop.
- `apps/task-board`, `apps/a2e-studio` and `apps/architecture-lab`: supporting interfaces.

## Local development

Node.js 22, npm, Docker and Docker Compose are required. Start with [the local stack guide](docs/local-docker-stack.md). Configure your own credentials and freshly generated secrets; none are supplied. Optional integrations such as Telegram, cloud tunnels, external providers and payments require separate accounts and configuration.

The repository excludes production data, generated project sites, private operational records and the original Git history. The published copy has its own history. Some deployment-specific workflows require adaptation to your infrastructure.

Website: [ralph-arena.com](https://ralph-arena.com)

## License

A license has not yet been selected. Public visibility does not itself grant a license to reuse this code.
