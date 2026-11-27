/**
 * RA-083: Cloud-init script generator for VPS provisioning.
 * Migrated from services/dispatcher/src/provisioners/cloud-init.ts.
 *
 * Updated for v2 architecture: installs worker-agent on VPS
 * so it self-registers with governance and claims runs.
 */

export type CloudInitConfig = {
  workerImage: string;
  previewDomain: string;
  acmeEmail: string;
  repoUrl?: string;
  repoBranch?: string;
  githubToken?: string;
  governanceUrl?: string;
  workerSecret?: string;
  hostId?: string;
};

export function generateCloudInit(config: CloudInitConfig): string {
  const { workerImage, previewDomain, acmeEmail } = config;
  const branch = config.repoBranch ?? "main";
  const domainless = previewDomain === "local";
  // RA-133: "auto" = no DNS configured, auto-discover IP and use nip.io
  const autoDiscover = previewDomain === "auto";

  let repoUrl = config.repoUrl ?? "https://github.com/Rrock-k/ralph-arena-public.git";
  if (config.githubToken && repoUrl.startsWith("https://github.com/")) {
    repoUrl = repoUrl.replace("https://github.com/", `https://x-access-token:${config.githubToken}@github.com/`);
  }

  const isRegistryImage = workerImage.includes("/");
  const buildArgToken = config.githubToken ? ` --build-arg GITHUB_TOKEN=${config.githubToken}` : "";

  // Clone step — needed for building worker image and deploying worker-agent
  const cloneStep = `  - git clone --depth 1 --branch ${branch} ${repoUrl} /tmp/arena-build`;
  const imageStep = isRegistryImage
    ? `  - docker pull ${workerImage}`
    : [
        `  # Build worker image from source`,
        cloneStep,
        `  - docker build -t ${workerImage}${buildArgToken} -f /tmp/arena-build/services/worker-agent/Dockerfile.worker /tmp/arena-build`,
      ].join("\n");

  // Caddy + preview domain setup
  const governanceUpstream = config.governanceUrl || "";

  let caddyStep: string;
  if (domainless) {
    caddyStep = "";
  } else if (autoDiscover) {
    // RA-133: Auto-discover public IP → use nip.io for wildcard preview (HTTP only)
    caddyStep = `
  # RA-133: Discover public IP for nip.io preview domain
  - PUBLIC_IP=$(curl -s http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || curl -s https://ifconfig.me)
  - 'echo "Discovered public IP = $PUBLIC_IP"'
  - PREVIEW_DOMAIN="$PUBLIC_IP.nip.io"

  # Write Caddyfile (HTTP only — nip.io has shared LE rate limits)
  # RA-055: forward_auth to remote governance for preview access control
  - mkdir -p /etc/caddy
  - |
    cat > /etc/caddy/Caddyfile <<CADDYEOF
	    (preview_no_store) {
	      header_down Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
	      header_down CDN-Cache-Control "no-store"
	      header_down Cloudflare-CDN-Cache-Control "no-store"
	      header_down Pragma "no-cache"
	      header_down Expires "0"
	    }

	    (preview_response_no_store) {
	      header Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
	      header CDN-Cache-Control "no-store"
	      header Cloudflare-CDN-Cache-Control "no-store"
	      header Pragma "no-cache"
	      header Expires "0"
	    }

	    http://*.$PREVIEW_DOMAIN:80 {
	      import preview_response_no_store
	      @hasSubdomain header_regexp container Host ^([^.]+)\.

      # Strip client-sent identity/access headers to prevent spoofing
      request_header -X-Ralph-User-Id
      request_header -X-Ralph-User-Email
      request_header -X-Ralph-User-Role
      request_header -X-Ralph-Anon-Id
      request_header -X-Arena-Project-Id
      request_header -X-Arena-Project-Role
      request_header -X-Arena-Project-Capabilities

      @preview_websocket {
        header Connection *Upgrade*
        header Upgrade websocket
      }
	      handle @preview_websocket {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {re.container.1}:3000
	      }

	      handle /sw.js {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {re.container.1}:3999 {
	          import preview_no_store
	        }
	      }

	      handle /__arena/preview-generation {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {re.container.1}:3999 {
	          import preview_no_store
	        }
	      }

	      handle /__arena/project-sw.js {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        rewrite * /sw.js
	        reverse_proxy {re.container.1}:3000 {
	          import preview_no_store
	        }
	      }

	      handle @hasSubdomain {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {re.container.1}:3000 {
	          import preview_no_store
	        }
	      }
	    }
    CADDYEOF

  # Run Caddy in Docker on arena-public-network (so it can resolve container names)
  - docker run -d --name caddy --network arena-public-network --restart always -p 80:80 -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine

  # Persist discovered domain for worker-agent
  - mkdir -p /etc/arena
  - echo "$PREVIEW_DOMAIN" > /etc/arena/preview-domain`;
  } else {
    // Explicit DNS domain — HTTPS with Let's Encrypt
    // RA-055: forward_auth to remote governance for preview access control
    caddyStep = `
  # Write Caddyfile
  - mkdir -p /etc/caddy
  - |
    cat > /etc/caddy/Caddyfile <<'CADDYEOF'
	    (preview_no_store) {
	      header_down Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
	      header_down CDN-Cache-Control "no-store"
	      header_down Cloudflare-CDN-Cache-Control "no-store"
	      header_down Pragma "no-cache"
	      header_down Expires "0"
	    }

	    (preview_response_no_store) {
	      header Cache-Control "no-store, no-cache, must-revalidate, max-age=0"
	      header CDN-Cache-Control "no-store"
	      header Cloudflare-CDN-Cache-Control "no-store"
	      header Pragma "no-cache"
	      header Expires "0"
	    }

	    *.${previewDomain} {
	      tls ${acmeEmail}
	      import preview_response_no_store

	      # Strip iframe-blocking headers set by agent-built apps
      header -X-Frame-Options
      header -Content-Security-Policy

      # Strip client-sent identity/access headers to prevent spoofing
      request_header -X-Ralph-User-Id
      request_header -X-Ralph-User-Email
      request_header -X-Ralph-User-Role
      request_header -X-Ralph-Anon-Id
      request_header -X-Arena-Project-Id
      request_header -X-Arena-Project-Role
      request_header -X-Arena-Project-Capabilities

      @preview_websocket {
        header Connection *Upgrade*
        header Upgrade websocket
      }
	      handle @preview_websocket {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {http.request.host.labels.2}:3000
	      }

	      handle /sw.js {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {http.request.host.labels.2}:3999 {
	          import preview_no_store
	        }
	      }

	      handle /__arena/preview-generation {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {http.request.host.labels.2}:3999 {
	          import preview_no_store
	        }
	      }

	      handle /__arena/project-sw.js {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        rewrite * /sw.js
	        reverse_proxy {http.request.host.labels.2}:3000 {
	          import preview_no_store
	        }
	      }

	      handle {
	        forward_auth ${governanceUpstream} {
	          uri /api/auth/preview-gate?host={host}
	          copy_headers X-Ralph-Anon-Id X-Arena-Project-Id X-Arena-Project-Role X-Arena-Project-Capabilities
	        }
	        reverse_proxy {http.request.host.labels.2}:3000 {
	          import preview_no_store
	        }
	      }
	    }
    CADDYEOF

  # Run Caddy in Docker on arena-public-network (so it can resolve container names)
  - docker run -d --name caddy --network arena-public-network --restart always -p 80:80 -p 443:443 -v /etc/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data caddy:2-alpine`;
  }

  const previewDomainSetup = autoDiscover
    ? `
  # RA-148: Write worker-agent env with discovered preview domain and build identity
  - |
    PREVIEW_DOMAIN=$(cat /etc/arena/preview-domain 2>/dev/null || echo "")
    ARENA_GIT_SHA=$(git -C /tmp/arena-build rev-parse --short=12 HEAD 2>/dev/null || echo "")
    ARENA_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    mkdir -p /etc/arena
    cat > /etc/arena/worker-agent.env <<EOF
    PREVIEW_DOMAIN=$PREVIEW_DOMAIN
    WORKER_IMAGE=${workerImage}
    WORKER_GIT_SHA=$ARENA_GIT_SHA
    RUNNER_GIT_SHA=$ARENA_GIT_SHA
    WORKER_BUILD_TIME=$ARENA_BUILD_TIME
    RUNNER_BUILD_TIME=$ARENA_BUILD_TIME
    EOF`
    : `
  # RA-148: Write worker-agent env with preview domain and build identity
  - |
    ARENA_GIT_SHA=$(git -C /tmp/arena-build rev-parse --short=12 HEAD 2>/dev/null || echo "")
    ARENA_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    mkdir -p /etc/arena
    cat > /etc/arena/worker-agent.env <<EOF
    PREVIEW_DOMAIN=${domainless ? "" : previewDomain}
    WORKER_IMAGE=${workerImage}
    WORKER_GIT_SHA=$ARENA_GIT_SHA
    RUNNER_GIT_SHA=$ARENA_GIT_SHA
    WORKER_BUILD_TIME=$ARENA_BUILD_TIME
    RUNNER_BUILD_TIME=$ARENA_BUILD_TIME
    EOF`;

  return `#cloud-config
package_update: true
packages:
  - git

runcmd:
  # Install Docker
  - curl -fsSL https://get.docker.com | sh

  # Fix DNS for Docker (Hetzner default resolver refuses queries from containers)
  - mkdir -p /etc/docker && echo '{"dns":["8.8.8.8","1.1.1.1"]}' > /etc/docker/daemon.json
  - systemctl restart docker

  # Worker image and network
${imageStep}
  - docker network create arena-public-network
  # RA-069: Block cloud metadata API from containers
  - iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
${caddyStep}

  # Create workspace directory
  - mkdir -p /workspace/projects

  # Install Node.js for worker-agent
  - curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  - apt-get install -y nodejs

  # Deploy worker-agent from a full repo checkout so file: workspace deps exist.
  - rm -rf /opt/agents-arena
  - test -d /tmp/arena-build/services/worker-agent || git clone --depth 1 --branch ${branch} ${repoUrl} /tmp/arena-build
  - cp -r /tmp/arena-build /opt/agents-arena
  - cd /opt/agents-arena/packages/contracts && npm ci && npm run build
  - cd /opt/agents-arena/services/worker-agent && npm ci && npx tsc
  - rm -rf /tmp/arena-build
${previewDomainSetup}

  # Create systemd service for worker-agent
  - |
    cat > /etc/systemd/system/arena-worker-agent.service <<EOF
    [Unit]
    Description=Arena Worker Agent
    After=docker.service
    Requires=docker.service

    [Service]
    Type=simple
    WorkingDirectory=/opt/agents-arena/services/worker-agent
    Environment=GOVERNANCE_URL=${config.governanceUrl || ""}
    Environment=WORKER_SECRET=${config.workerSecret || ""}
    Environment=HOST_ID=${config.hostId || "vps"}
    Environment=ARENA_NETWORK=arena-public-network
    Environment=ARENA_PROJECT_WORKSPACES_ROOT=/workspace/projects
    EnvironmentFile=-/etc/arena/worker-agent.env
    ExecStart=/usr/bin/node dist/index.js
    Restart=always
    RestartSec=5

    [Install]
    WantedBy=multi-user.target
    EOF
  - systemctl daemon-reload
  - systemctl enable arena-worker-agent
  - systemctl start arena-worker-agent

  # Signal readiness
  - touch /tmp/ready
`;
}
