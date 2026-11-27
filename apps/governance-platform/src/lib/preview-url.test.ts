import { describe, expect, it } from "vitest";
import {
  buildPreviewUrlFromDomain,
  getPreferredPreviewUrl,
  getProjectPreviewOpenHref,
  isMixedContentPreviewUrl,
  isLocalPreviewUrl,
  isSubdomainPreviewUrl,
  isValidPreviewUrl,
} from "./preview-url";

describe("preview-url helpers", () => {
  describe("isValidPreviewUrl", () => {
    it("accepts local deployments path", () => {
      expect(isValidPreviewUrl("/deployments/demo-app")).toBe(true);
    });

    it("accepts absolute http/https urls", () => {
      expect(isValidPreviewUrl("http://203.0.113.20:33515")).toBe(true);
      expect(isValidPreviewUrl("https://preview.example.com/app")).toBe(true);
      expect(isValidPreviewUrl("https://preview-abc123.arena.example.test")).toBe(true);
    });

    it("rejects unsupported urls", () => {
      expect(isValidPreviewUrl("javascript:alert(1)")).toBe(false);
      expect(isValidPreviewUrl("ftp://example.com")).toBe(false);
      expect(isValidPreviewUrl("")).toBe(false);
    });
  });

  describe("isMixedContentPreviewUrl", () => {
    it("detects https page embedding an http target", () => {
      expect(isMixedContentPreviewUrl("http://203.0.113.20:33515", "https")).toBe(true);
      expect(isMixedContentPreviewUrl("http://203.0.113.20:33515", "https:")).toBe(true);
    });

    it("allows https targets and relative urls", () => {
      expect(isMixedContentPreviewUrl("https://preview.example.com/demo", "https")).toBe(false);
      expect(isMixedContentPreviewUrl("/deployments/demo-app", "https")).toBe(false);
    });

    it("does not flag mixed content on http pages", () => {
      expect(isMixedContentPreviewUrl("http://203.0.113.20:33515", "http")).toBe(false);
    });
  });

  describe("isLocalPreviewUrl", () => {
    it("detects localhost URLs", () => {
      expect(isLocalPreviewUrl("http://preview-abc.localhost:8080")).toBe(true);
      expect(isLocalPreviewUrl("http://localhost:3000")).toBe(true);
      expect(isLocalPreviewUrl("http://127.0.0.1:8080")).toBe(true);
    });

    it("allows public URLs", () => {
      expect(isLocalPreviewUrl("https://preview-abc.arena.example.test")).toBe(false);
      expect(isLocalPreviewUrl("http://preview-abc.192.0.2.20.nip.io:8080")).toBe(false);
    });

    it("handles edge cases", () => {
      expect(isLocalPreviewUrl("")).toBe(false);
      expect(isLocalPreviewUrl("not-a-url")).toBe(false);
    });
  });

  describe("isSubdomainPreviewUrl", () => {
    it("detects subdomain preview URLs", () => {
      expect(isSubdomainPreviewUrl("https://preview-abc123.arena.example.test")).toBe(true);
      expect(isSubdomainPreviewUrl("https://preview-run42.localhost:8080")).toBe(true);
    });

    it("rejects non-preview URLs", () => {
      expect(isSubdomainPreviewUrl("https://arena.example.test")).toBe(false);
      expect(isSubdomainPreviewUrl("http://preview-abc.arena.example.test")).toBe(false); // http, not https
      expect(isSubdomainPreviewUrl("/deployments/demo")).toBe(false);
      expect(isSubdomainPreviewUrl("")).toBe(false);
    });
  });

  describe("buildPreviewUrlFromDomain", () => {
    it("builds the public preview url from an explicit domain", () => {
      expect(buildPreviewUrlFromDomain("preview-claude-0loq94", "arena.example.test")).toBe(
        "https://preview-claude-0loq94.arena.example.test",
      );
    });

    it("uses http for localhost-style domains", () => {
      expect(buildPreviewUrlFromDomain("preview-claude-0loq94", "localhost")).toBe(
        "http://preview-claude-0loq94.localhost",
      );
    });

    it("returns null when the domain is missing", () => {
      expect(buildPreviewUrlFromDomain("preview-claude-0loq94", null)).toBeNull();
    });
  });

  describe("getPreferredPreviewUrl", () => {
    it("keeps an already-public preview url", () => {
      expect(getPreferredPreviewUrl({
        previewUrl: "https://preview-space-invaders.arena.example.test",
        containerName: "preview-space-invaders",
        previewDomain: "arena.example.test",
      })).toBe("https://preview-space-invaders.arena.example.test");
    });

    it("rebuilds a stale local preview url to the public host", () => {
      expect(getPreferredPreviewUrl({
        previewUrl: "http://preview-space-invaders.localhost:8080",
        containerName: "preview-space-invaders",
        previewDomain: "arena.example.test",
      })).toBe("https://preview-space-invaders.arena.example.test");
    });

    it("derives a preview url when only container identity is present", () => {
      expect(getPreferredPreviewUrl({
        previewUrl: null,
        containerName: "preview-space-invaders",
        previewDomain: "arena.example.test",
      })).toBe("https://preview-space-invaders.arena.example.test");
    });
  });

  describe("getProjectPreviewOpenHref", () => {
    it("uses the shared preview redirect path by default", () => {
      expect(getProjectPreviewOpenHref("project-123")).toBe(
        "/api/auth/preview-redirect?projectId=project-123",
      );
    });

    it("builds an absolute governance url when a public base is provided", () => {
      expect(getProjectPreviewOpenHref("project-123", "https://arena.example.test")).toBe(
        "https://arena.example.test/api/auth/preview-redirect?projectId=project-123",
      );
    });

    it("encodes project ids safely", () => {
      expect(getProjectPreviewOpenHref("project with spaces")).toBe(
        "/api/auth/preview-redirect?projectId=project%20with%20spaces",
      );
    });
  });
});
