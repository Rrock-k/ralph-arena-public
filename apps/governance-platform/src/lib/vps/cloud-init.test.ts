import { describe, expect, it } from "vitest";
import { generateCloudInit } from "./cloud-init";

describe("generateCloudInit", () => {
  function expectPreviewCacheBoundary(script: string) {
    expect(script).toContain("(preview_no_store)");
    expect(script).toContain('header_down Cache-Control "no-store, no-cache, must-revalidate, max-age=0"');
    expect(script).toContain('header_down CDN-Cache-Control "no-store"');
    expect(script).toContain('header_down Cloudflare-CDN-Cache-Control "no-store"');
    expect(script).toContain("import preview_response_no_store");
    expect(script).toContain('header Cloudflare-CDN-Cache-Control "no-store"');
    expect(script).toContain("handle /sw.js");
    expect(script).toContain("handle /__arena/preview-generation");
    expect(script).toContain("handle /__arena/project-sw.js");
    expect(script).toContain("import preview_no_store");
  }

  it("deploys worker-agent from a full repo checkout so file dependencies resolve", () => {
    const script = generateCloudInit({
      workerImage: "registry.example.com/arena-worker:latest",
      previewDomain: "auto",
      acmeEmail: "admin@example.com",
      repoUrl: "https://github.com/example/agents-arena.git",
      repoBranch: "main",
      governanceUrl: "https://app.example.com",
      workerSecret: "secret",
      hostId: "vps-test",
    });

    expect(script).toContain("cp -r /tmp/arena-build /opt/agents-arena");
    expect(script).toContain(
      "cd /opt/agents-arena/packages/contracts && npm ci && npm run build",
    );
    expect(script).toContain(
      "cd /opt/agents-arena/services/worker-agent && npm ci && npx tsc",
    );
    expect(script).toContain(
      "WorkingDirectory=/opt/agents-arena/services/worker-agent",
    );
    expect(script).not.toContain("WorkingDirectory=/opt/worker-agent");
    expect(script).not.toContain(
      "cp -r /tmp/arena-build/services/worker-agent/* /opt/worker-agent/",
    );
  });

  it("adds preview no-store ingress policy to auto-discovered preview domains", () => {
    const script = generateCloudInit({
      workerImage: "registry.example.com/arena-worker:latest",
      previewDomain: "auto",
      acmeEmail: "admin@example.com",
      governanceUrl: "https://app.example.com",
    });

    expectPreviewCacheBoundary(script);
    expect(script).toContain("reverse_proxy {re.container.1}:3999");
    expect(script).toContain("reverse_proxy {re.container.1}:3000");
  });

  it("adds preview no-store ingress policy to explicit preview domains", () => {
    const script = generateCloudInit({
      workerImage: "registry.example.com/arena-worker:latest",
      previewDomain: "preview.example.com",
      acmeEmail: "admin@example.com",
      governanceUrl: "https://app.example.com",
    });

    expectPreviewCacheBoundary(script);
    expect(script).toContain("reverse_proxy {http.request.host.labels.2}:3999");
    expect(script).toContain("reverse_proxy {http.request.host.labels.2}:3000");
  });
});
