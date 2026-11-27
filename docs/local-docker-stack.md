# Local Docker stack

The stack uses a separate `arena-public-review` Compose project and `arena-public-network` Docker network. It contains PostgreSQL, governance, authd, the worker, the API proxy, task board and Caddy. The tunnel and automation bot are opt-in profiles and require separate configuration.

1. Install Docker with Compose and Node.js 22, and ensure the ports in `docker-compose.local.yml` are available.
2. Copy `.env.example` to `.env.local` and `apps/governance-platform/.env.example` to `apps/governance-platform/.env.local`. Generate new, unique secrets and configure the providers you intend to use. Never use another installation's credentials.
3. Run `./scripts/docker-local-stack.sh up -d --build`. The governance production image is built from committed `HEAD`; commit local changes before rebuilding it.
4. Initialize a fresh database after PostgreSQL starts:

   ```sh
   ./scripts/docker-local-stack.sh verify 'apt-get update -qq && apt-get install -y -qq openssl >/dev/null && npm --prefix apps/governance-platform ci --no-audit --no-fund && cd apps/governance-platform && DATABASE_URL=postgresql://ralph:ralph@postgres:5432/ralph_arena npx prisma migrate deploy'
   ```

   This uses the default local Compose database. If you configure another database, set its URL accordingly.
5. Inspect `./scripts/docker-local-stack.sh ps` and `./scripts/docker-local-stack.sh logs -f --tail=100`. The governance UI listens on port 3000 and the local router on 8080.
6. Stop the stack with `./scripts/docker-local-stack.sh down`. Persistent volumes are retained.

The worker requires access to the host Docker socket to manage preview containers. Treat this stack as trusted local infrastructure. Real agent runs require independently configured provider credentials and authentication. The `tunnel` profile is a template: configure your own domain and Cloudflare credentials before enabling it. VPS deployment templates and production operational records are not included in this review copy.

For isolated package checks, `./scripts/docker-local-stack.sh verify '<shell command>'` runs a disposable Node container with the repository mounted. This helper does not start the other services.
