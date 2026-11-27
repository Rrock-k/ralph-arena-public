/**
 * RA-083: Hetzner Cloud VPS provisioner.
 * Migrated from services/dispatcher/src/provisioners/hetzner.ts.
 */
import { generateKeyPairSync } from "node:crypto";
import { generateCloudInit, type CloudInitConfig } from "./cloud-init";

const HETZNER_API = "https://api.hetzner.cloud/v1";
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000;

export type HetznerConfig = {
  apiToken: string;
  defaultRegion: string;
  defaultServerType: string;
  workerImage: string;
  previewDomain: string;
  acmeEmail: string;
  githubToken?: string;
  governanceUrl?: string;
  workerSecret?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
};

export type ProvisionResult = {
  serverId: string;
  ip: string;
  sshKeyId: string;
  sshKey: { publicKey: string; privateKey: string };
};

export type HetznerServer = {
  id: string;
  name: string;
  status?: string;
  ip?: string;
  serverType?: string;
  location?: string;
  created?: string;
};

export type HetznerSshKey = {
  id: string;
  name: string;
};

export async function provisionVps(
  config: HetznerConfig,
  label: string,
  opts?: { region?: string; serverType?: string },
): Promise<ProvisionResult> {
  const region = opts?.region ?? config.defaultRegion;
  const serverType = opts?.serverType ?? config.defaultServerType;

  // 1. Generate SSH key pair
  const sshKey = generateSshKeyPair();

  // 2. Upload public key to Hetzner
  const suffix = Math.random().toString(36).slice(2, 8);
  const keyName = `arena-${label}-${suffix}`;
  const keyRes = await hetznerFetch(config.apiToken, "POST", "/ssh_keys", {
    name: keyName,
    public_key: sshKey.publicKey,
  });
  const sshKeyId = String(keyRes.ssh_key.id);

  // 3. Generate cloud-init
  const cloudInit = generateCloudInit({
    workerImage: config.workerImage,
    previewDomain: config.previewDomain,
    acmeEmail: config.acmeEmail,
    githubToken: config.githubToken,
    governanceUrl: config.governanceUrl,
    workerSecret: config.workerSecret,
    hostId: `vps-${label}`,
  });

  // 4. Create server
  const serverSuffix = Math.random().toString(36).slice(2, 8);
  const serverRes = await hetznerFetch(config.apiToken, "POST", "/servers", {
    name: `arena-${label}-${serverSuffix}`,
    server_type: serverType,
    location: region,
    image: "ubuntu-24.04",
    ssh_keys: [Number(sshKeyId)],
    user_data: cloudInit,
  });
  const serverId = String(serverRes.server.id);

  // 5. Poll until running
  const timeout = config.pollTimeoutMs ?? POLL_TIMEOUT_MS;
  const interval = config.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const res = await hetznerFetch(config.apiToken, "GET", `/servers/${serverId}`);
    if (res.server.status === "running") break;
    await sleep(interval);
  }

  // 6. Get IP
  const details = await hetznerFetch(config.apiToken, "GET", `/servers/${serverId}`);
  const ip: string = details.server.public_net.ipv4.ip;

  return { serverId, ip, sshKeyId, sshKey };
}

export async function destroyVps(
  apiToken: string,
  serverId: string,
  sshKeyId?: string,
): Promise<void> {
  const errors: Error[] = [];
  try {
    await hetznerFetch(apiToken, "DELETE", `/servers/${serverId}`);
  } catch (err) {
    errors.push(err as Error);
  }
  if (sshKeyId) {
    try {
      await hetznerFetch(apiToken, "DELETE", `/ssh_keys/${sshKeyId}`);
    } catch (err) {
      errors.push(err as Error);
    }
  }
  if (errors.length > 0) {
    throw new Error(`destroyVps partial failure: ${errors.map((e) => e.message).join("; ")}`);
  }
}

export async function listServers(apiToken: string): Promise<HetznerServer[]> {
  const res = await hetznerFetch(apiToken, "GET", "/servers?per_page=100") as {
    servers?: Array<{
      id: number | string;
      name: string;
      status?: string;
      public_net?: { ipv4?: { ip?: string } };
      server_type?: { name?: string };
      datacenter?: { location?: { name?: string } };
      created?: string;
    }>;
  };
  return (res.servers ?? []).map((server) => ({
    id: String(server.id),
    name: server.name,
    status: server.status,
    ip: server.public_net?.ipv4?.ip,
    serverType: server.server_type?.name,
    location: server.datacenter?.location?.name,
    created: server.created,
  }));
}

export async function listSshKeys(apiToken: string): Promise<HetznerSshKey[]> {
  const res = await hetznerFetch(apiToken, "GET", "/ssh_keys?per_page=100") as {
    ssh_keys?: Array<{ id: number | string; name: string }>;
  };
  return (res.ssh_keys ?? []).map((key) => ({
    id: String(key.id),
    name: key.name,
  }));
}

export async function rebootServer(apiToken: string, serverId: string): Promise<void> {
  await hetznerFetch(apiToken, "POST", `/servers/${serverId}/actions/reboot`);
}

export async function deleteSshKey(apiToken: string, sshKeyId: string): Promise<void> {
  await hetznerFetch(apiToken, "DELETE", `/ssh_keys/${sshKeyId}`);
}

// ── DNS ────────────────────────────────────────────

const HETZNER_DNS_API = "https://dns.hetzner.com/api/v1";

export async function createDnsRecords(
  dnsToken: string,
  zoneId: string,
  subdomain: string,
  ip: string,
): Promise<void> {
  await hetznerDnsFetch(dnsToken, "POST", "/records", {
    zone_id: zoneId,
    type: "A",
    name: subdomain,
    value: ip,
    ttl: 300,
  });
  await hetznerDnsFetch(dnsToken, "POST", "/records", {
    zone_id: zoneId,
    type: "A",
    name: `*.${subdomain}`,
    value: ip,
    ttl: 300,
  });
}

export async function deleteDnsRecords(
  dnsToken: string,
  zoneId: string,
  subdomain: string,
): Promise<void> {
  const data = (await hetznerDnsFetch(
    dnsToken,
    "GET",
    `/records?zone_id=${zoneId}`,
  )) as { records: { id: string; name: string }[] };

  const matching = data.records.filter(
    (r) => r.name === subdomain || r.name === `*.${subdomain}`,
  );

  for (const record of matching) {
    await hetznerDnsFetch(dnsToken, "DELETE", `/records/${record.id}`);
  }
}

// ── Helpers ────────────────────────────────────────

async function hetznerFetch(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hetzner API ${method} ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return {};
  return res.json();
}

async function hetznerDnsFetch(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${HETZNER_DNS_API}${path}`, {
    method,
    headers: {
      "Auth-API-Token": token,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hetzner DNS API ${method} ${path} failed (${res.status}): ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

function generateSshKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Convert PEM public key to OpenSSH format for Hetzner API
  const pubDer = Buffer.from(
    publicKey.replace(/-----BEGIN PUBLIC KEY-----/, "")
      .replace(/-----END PUBLIC KEY-----/, "")
      .replace(/\n/g, ""),
    "base64",
  );
  // Ed25519 SPKI: 12-byte header (30 2a 30 05 06 03 2b 65 70 03 21 00) + 32-byte key
  const rawKey = pubDer.subarray(12);
  const keyType = Buffer.from("ssh-ed25519");
  const sshPub = Buffer.concat([
    Buffer.from([0, 0, 0, keyType.length]),
    keyType,
    Buffer.from([0, 0, 0, rawKey.length]),
    rawKey,
  ]);
  const openSshPublicKey = `ssh-ed25519 ${sshPub.toString("base64")} arena@ralph`;

  return { publicKey: openSshPublicKey, privateKey };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
