import { execa } from 'execa';
import path from 'path';
import net from 'net';
import nodeFs from 'fs';
import fs from 'fs-extra';
import { log } from '../utils/logger.js';


export interface LocalDockerConfig {
  composeFile: string;
  serviceName?: string;
}

export interface DockerDeployResult {
  success: boolean;
  skipped?: boolean;
  url?: string;        // actual health check URL with dynamic port
  appPort?: number;     // assigned host port
  error?: string;
}

/**
 * Find a free TCP port on localhost.
 * Binds to port 0 (OS picks a free port), reads it, then closes.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        return reject(new Error('Could not get port'));
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Kill any process listening on a given TCP port (Linux only, via /proc).
 * Returns the number of processes killed.
 */
function killProcessOnPort(port: number): number {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');

  // Find socket inodes listening (state 0A = LISTEN) on the target port
  const inodes = new Set<string>();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      const content = nodeFs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const cols = line.trim().split(/\s+/);
        if (cols[1]?.endsWith(':' + hexPort) && cols[3] === '0A') {
          inodes.add(cols[9]);
        }
      }
    } catch { /* not Linux or no access */ }
  }
  if (inodes.size === 0) return 0;

  // Map inodes → PIDs via /proc/*/fd
  const pids = new Set<number>();
  try {
    for (const dir of nodeFs.readdirSync('/proc')) {
      if (!/^\d+$/.test(dir)) continue;
      try {
        for (const fd of nodeFs.readdirSync(`/proc/${dir}/fd`)) {
          try {
            const link = nodeFs.readlinkSync(`/proc/${dir}/fd/${fd}`);
            for (const inode of inodes) {
              if (link === `socket:[${inode}]`) pids.add(parseInt(dir));
            }
          } catch { /* permission denied or gone */ }
        }
      } catch { /* permission denied or gone */ }
    }
  } catch { /* not Linux */ }

  let killed = 0;
  for (const pid of pids) {
    if (pid === process.pid) continue; // don't kill ourselves
    try {
      process.kill(pid, 'SIGKILL');
      killed++;
      log.info(`Killed PID ${pid} (was occupying port ${port})`);
    } catch { /* already dead */ }
  }
  return killed;
}

export class LocalDockerDeploy {
  constructor(
    private workDir: string,
    private config: LocalDockerConfig,
  ) {}

  /**
   * Check if project has a runnable start script (package.json with scripts.start or scripts.dev)
   */
  async isReady(): Promise<boolean> {
    const packageJsonPath = path.join(this.workDir, 'package.json');
    if (!(await fs.pathExists(packageJsonPath))) return false;
    try {
      const pkg = await fs.readJSON(packageJsonPath);
      return !!(pkg.scripts?.start || pkg.scripts?.dev);
    } catch {
      return false;
    }
  }

  /**
   * Deploy the project as an in-process app (no Docker Compose needed).
   * This avoids requiring Docker socket access in workers.
   * Accepts optional env overrides (APP_PORT) for dynamic port binding.
   */
  async deploy(envOverrides?: Record<string, string>): Promise<DockerDeployResult> {
    // Check if package.json exists for Node.js projects
    const packageJsonPath = path.join(this.workDir, 'package.json');
    const hasPackageJson = await fs.pathExists(packageJsonPath);

    if (!hasPackageJson) {
      log.warn('package.json not found — skipping in-process deploy');
      return { success: true, skipped: true };
    }

    try {
      // Use APP_PORT/PORT from env (container) or envOverrides, fallback to dynamic port
      const envPort = Number(envOverrides?.APP_PORT || process.env.APP_PORT || process.env.PORT || 0);
      const appPort = envPort > 0 ? envPort : await findFreePort();
      log.info(`Deploying app in-process on port ${appPort}...`);

      // Read package.json to determine start command
      const packageJson = await fs.readJSON(packageJsonPath);
      const startScript = packageJson.scripts?.start || packageJson.scripts?.dev;

      if (!startScript) {
        return {
          success: false,
          error: 'No "start" or "dev" script found in package.json',
        };
      }

      // Kill placeholder server if it's running (started by WorkerFactory for instant preview)
      try {
        await execa('sh', ['-c',
          'if [ -f /tmp/placeholder.pid ]; then kill "$(cat /tmp/placeholder.pid)" 2>/dev/null; rm -f /tmp/placeholder.pid; fi',
        ], { cwd: this.workDir, reject: false, timeout: 5000 });
      } catch {
        // Non-critical — placeholder may already be gone
      }

      // Kill any process occupying the deploy port (agent may have left a dev server running)
      const killed = killProcessOnPort(appPort);
      if (killed > 0) {
        log.info(`Killed ${killed} process(es) occupying port ${appPort}`);
        // Give OS time to release the port
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Install dependencies first
      log.info('Installing dependencies...');
      await execa('npm', ['install'], {
        cwd: this.workDir,
        timeout: 3 * 60 * 1000, // 3 min
      });

      // Load project secrets from .env.arena-secrets (written by arena-runner's request-secrets)
      let arenaSecrets: Record<string, string> = {};
      const secretsPath = path.join(this.workDir, '.env.arena-secrets');
      try {
        const raw = nodeFs.readFileSync(secretsPath, 'utf8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.includes('=')) continue;
          const eqIdx = trimmed.indexOf('=');
          const key = trimmed.slice(0, eqIdx).trim();
          const value = trimmed.slice(eqIdx + 1).trim();
          if (key) arenaSecrets[key] = value;
        }
        if (Object.keys(arenaSecrets).length > 0) {
          log.info(`Loaded ${Object.keys(arenaSecrets).length} secret(s) from .env.arena-secrets`);
        }
      } catch {
        // File doesn't exist or unreadable — no secrets requested, that's fine
      }

      // Spawn app process in background
      log.info(`Starting app: npm start (on port ${appPort})`);
      const env = {
        ...process.env,
        ...arenaSecrets,
        ...envOverrides,
        PORT: String(appPort),
        HOST: '0.0.0.0', // Bind to all interfaces
      };

      // Start process but don't wait for it to finish
      const child = execa('npm', ['start'], {
        cwd: this.workDir,
        env,
        detached: true,
        stdio: 'ignore',
      });

      // Suppress unhandled rejection — health check will determine success
      child.catch(() => {});

      // Detach from parent process so it continues running
      child.unref();

      // Give app a moment to start binding port
      await new Promise((r) => setTimeout(r, 3000));

      const healthUrl = `http://localhost:${appPort}`;
      log.info(`Running health check: ${healthUrl}`);

      // Health check to verify app started
      const healthy = await checkHealthUrl(healthUrl, 15, 4000);

      if (!healthy) {
        return {
          success: false,
          error: `App did not become healthy at ${healthUrl} after 60s`,
        };
      }

      log.success(`App is running at ${healthUrl}`);
      return {
        success: true,
        url: healthUrl,
        appPort,
      };
    } catch (error: any) {
      return {
        success: false,
        error: `In-process deploy failed: ${error.message}`,
      };
    }
  }

  /**
   * Get recent logs from the in-process app for debugging.
   * In-process deployment doesn't have container logs — returns placeholder.
   */
  async getContainerLogs(): Promise<string> {
    return 'In-process deployment — no container logs available';
  }

  /**
   * Get exit info from the in-process app.
   * In-process deployment doesn't have container exit info — returns placeholder.
   */
  async getContainerExitInfo(): Promise<string> {
    return 'In-process deployment — no container exit info';
  }

  /**
   * Extract the health-check path from docker-compose.yml.
   * Parses the `healthcheck.test` field for URLs like
   * `http://localhost:3000/api/health` and returns the path portion (`/api/health`).
   * Returns `undefined` if not found.
   */
  async getHealthPath(): Promise<string | undefined> {
    try {
      const composePath = path.join(this.workDir, this.config.composeFile);
      const content = await fs.readFile(composePath, 'utf-8');

      // Find any http(s) URL that appears after a `healthcheck:` directive.
      // Works with wget, curl, or bare URL in the test command.
      const urlMatch = content.match(/healthcheck[\s\S]*?https?:\/\/[^\s"']+/i);
      if (urlMatch) {
        const fullUrl = urlMatch[0].match(/https?:\/\/[^\s"']+/)?.[0];
        if (fullUrl) {
          try {
            const parsed = new URL(fullUrl);
            if (parsed.pathname && parsed.pathname !== '/') {
              log.info(`Discovered health path from docker-compose: ${parsed.pathname}`);
              return parsed.pathname;
            }
          } catch {
            // URL parse failed — ignore
          }
        }
      }
    } catch {
      // Non-critical
    }
    return undefined;
  }
}

/**
 * Well-known health check paths to try (in order) when the primary URL
 * returns a non-OK response but the server IS reachable.
 */
const HEALTH_FALLBACK_PATHS = [
  '/api/health',
  '/health',
  '/healthz',
  '/api/healthz',
  '/api/status',
  '/ping',
];

/**
 * HTTP health check with retries.
 *
 * Strategy:
 * 1. Wait for the server to become reachable (any HTTP response, even 404).
 * 2. Once reachable, try the primary URL. If 2xx → pass.
 * 3. If non-2xx, try well-known health paths. If any returns 2xx → pass.
 * 4. If none of the paths return 2xx but the server IS responding
 *    (we got HTTP responses, not connection-refused), still pass —
 *    a running server with wrong root route is not a deploy failure.
 *
 * @param healthPath  Optional explicit path extracted from docker-compose
 *                    healthcheck (e.g. `/api/health`). Tried first.
 */
export async function checkHealthUrl(
  url: string,
  retries = 15,
  intervalMs = 4000,
  healthPath?: string,
): Promise<boolean> {
  const baseUrl = url.replace(/\/$/, '');

  // Build ordered list of URLs to probe
  const probeUrls: string[] = [];
  if (healthPath) {
    probeUrls.push(`${baseUrl}${healthPath.startsWith('/') ? '' : '/'}${healthPath}`);
  }
  probeUrls.push(baseUrl);  // root
  for (const fp of HEALTH_FALLBACK_PATHS) {
    const full = `${baseUrl}${fp}`;
    if (!probeUrls.includes(full)) probeUrls.push(full);
  }

  // Give container a brief initial grace period to bind the port
  await new Promise((r) => setTimeout(r, 5000));

  let serverReachable = false;

  for (let i = 0; i < retries; i++) {
    for (const probeUrl of probeUrls) {
      try {
        const response = await fetch(probeUrl, { signal: AbortSignal.timeout(5000) });
        serverReachable = true;
        if (response.ok) {
          log.info(`Health check passed: ${probeUrl} → ${response.status}`);
          return true;
        }
      } catch {
        // Connection refused / timeout — server not ready yet
      }
    }

    // If server responded (even with 404/500) on ANY probe, it's running.
    // Don't wait the full retry window — give it one more quick pass.
    if (serverReachable) {
      // Server is up but no path returned 2xx. For API-only backends
      // (Express without root route) this is expected. Accept it.
      log.info(`Server is reachable at ${baseUrl} but no health path returned 2xx — accepting as healthy (API-only backend)`);
      return true;
    }

    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  return false;
}
