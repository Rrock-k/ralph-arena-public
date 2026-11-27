import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getAdminEmails,
  getAdminTelegramUserIds,
  shouldBeAdmin,
  shouldTelegramUserBeAdmin,
} from "./auth-utils";

describe("Auth Utils", () => {
  const originalEnv = process.env.ADMIN_EMAILS;
  const originalTelegramEnv = process.env.ADMIN_TELEGRAM_USER_IDS;

  afterEach(() => {
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.ADMIN_EMAILS = originalEnv;
    } else {
      delete process.env.ADMIN_EMAILS;
    }

    if (originalTelegramEnv !== undefined) {
      process.env.ADMIN_TELEGRAM_USER_IDS = originalTelegramEnv;
    } else {
      delete process.env.ADMIN_TELEGRAM_USER_IDS;
    }
  });

  describe("getAdminEmails", () => {
    it("should return array of admin emails from environment variable", () => {
      process.env.ADMIN_EMAILS = "admin1@example.com,admin2@example.com";

      const emails = getAdminEmails();

      expect(emails).toEqual(["admin1@example.com", "admin2@example.com"]);
    });

    it("should trim whitespace from email addresses", () => {
      process.env.ADMIN_EMAILS = " admin1@example.com , admin2@example.com ";

      const emails = getAdminEmails();

      expect(emails).toEqual(["admin1@example.com", "admin2@example.com"]);
    });

    it("should filter out empty strings", () => {
      process.env.ADMIN_EMAILS = "admin1@example.com,,admin2@example.com,";

      const emails = getAdminEmails();

      expect(emails).toEqual(["admin1@example.com", "admin2@example.com"]);
    });

    it("should return empty array when ADMIN_EMAILS is not set", () => {
      delete process.env.ADMIN_EMAILS;

      const emails = getAdminEmails();

      expect(emails).toEqual([]);
    });

    it("should return empty array when ADMIN_EMAILS is empty string", () => {
      process.env.ADMIN_EMAILS = "";

      const emails = getAdminEmails();

      expect(emails).toEqual([]);
    });

    it("should handle single admin email", () => {
      process.env.ADMIN_EMAILS = "admin@example.com";

      const emails = getAdminEmails();

      expect(emails).toEqual(["admin@example.com"]);
    });
  });

  describe("shouldBeAdmin", () => {
    beforeEach(() => {
      process.env.ADMIN_EMAILS = "admin1@example.com,admin2@example.com";
    });

    it("should return true for emails in the admin list", () => {
      expect(shouldBeAdmin("admin1@example.com")).toBe(true);
      expect(shouldBeAdmin("admin2@example.com")).toBe(true);
    });

    it("should return false for emails not in the admin list", () => {
      expect(shouldBeAdmin("user@example.com")).toBe(false);
      expect(shouldBeAdmin("other@example.com")).toBe(false);
    });

    it("should be case-sensitive", () => {
      expect(shouldBeAdmin("ADMIN1@EXAMPLE.COM")).toBe(false);
      expect(shouldBeAdmin("Admin1@Example.com")).toBe(false);
    });

    it("should return false when ADMIN_EMAILS is not set", () => {
      delete process.env.ADMIN_EMAILS;

      expect(shouldBeAdmin("admin@example.com")).toBe(false);
    });

    it("should handle whitespace in admin emails correctly", () => {
      process.env.ADMIN_EMAILS = " admin1@example.com , admin2@example.com ";

      expect(shouldBeAdmin("admin1@example.com")).toBe(true);
      expect(shouldBeAdmin(" admin1@example.com ")).toBe(false);
    });
  });

  describe("Bootstrap Admin Email Matching", () => {
    it("should correctly identify bootstrap superadmins based on email", () => {
      process.env.ADMIN_EMAILS = "admin@example.com";

      const adminEmail = "admin@example.com";
      const userEmail = "user@example.com";

      expect(shouldBeAdmin(adminEmail)).toBe(true);
      expect(shouldBeAdmin(userEmail)).toBe(false);
    });
  });

  describe("Telegram admin matching", () => {
    it("should return trimmed Telegram user ids from the environment", () => {
      process.env.ADMIN_TELEGRAM_USER_IDS = "12345, 67890,,";

      expect(getAdminTelegramUserIds()).toEqual(["12345", "67890"]);
    });

    it("should match Telegram user ids by exact numeric string", () => {
      process.env.ADMIN_TELEGRAM_USER_IDS = "12345,67890";

      expect(shouldTelegramUserBeAdmin("12345")).toBe(true);
      expect(shouldTelegramUserBeAdmin(67890)).toBe(true);
      expect(shouldTelegramUserBeAdmin("999")).toBe(false);
    });
  });
});
