import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jwtCallback, sessionCallback, type UserLookup } from "./auth-callbacks";
import type { JWT } from "next-auth/jwt";
import type { Session, User } from "next-auth";

describe("Auth Callbacks", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    process.env.ADMIN_EMAILS = "";
  });

  afterEach(() => {
    if (originalAdminEmails !== undefined) {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    } else {
      delete process.env.ADMIN_EMAILS;
    }
  });

  describe("jwtCallback", () => {
    it("should add user id and role to token when user is present", async () => {
      const mockUser: User = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      };

      const mockUserLookup: UserLookup = {
        findUnique: vi.fn().mockResolvedValue({ role: "ADMIN" }),
      };

      const token: JWT = {};

      const result = await jwtCallback(token, mockUser, mockUserLookup);

      expect(result.id).toBe("user-123");
      expect(result.role).toBe("ADMIN");
      expect(mockUserLookup.findUnique).toHaveBeenCalledWith({
        where: { id: "user-123" },
        select: { role: true },
      });
    });

    it("should default role to USER when database lookup returns null", async () => {
      const mockUser: User = {
        id: "user-456",
        email: "new@example.com",
        name: "New User",
      };

      const mockUserLookup: UserLookup = {
        findUnique: vi.fn().mockResolvedValue(null),
      };

      const token: JWT = {};

      const result = await jwtCallback(token, mockUser, mockUserLookup);

      expect(result.id).toBe("user-456");
      expect(result.role).toBe("USER");
    });

    it("should refresh role from database when user is undefined but token has id", async () => {
      const mockUserLookup: UserLookup = {
        findUnique: vi.fn().mockResolvedValue({ role: "ADMIN" }),
      };

      const token: JWT = {
        id: "existing-id",
        role: "USER",
      };

      const result = await jwtCallback(token, undefined, mockUserLookup);

      expect(result.id).toBe("existing-id");
      expect(result.role).toBe("ADMIN");
      expect(mockUserLookup.findUnique).toHaveBeenCalledWith({
        where: { id: "existing-id" },
        select: { role: true },
      });
    });

    it("should preserve token when no user and no token id", async () => {
      const mockUserLookup: UserLookup = {
        findUnique: vi.fn(),
      };

      const token: JWT = {};

      const result = await jwtCallback(token, undefined, mockUserLookup);

      expect(result.id).toBeUndefined();
      expect(result.role).toBeUndefined();
      expect(mockUserLookup.findUnique).not.toHaveBeenCalled();
    });

    it("should handle USER role from database", async () => {
      const mockUser: User = {
        id: "user-789",
        email: "regular@example.com",
        name: "Regular User",
      };

      const mockUserLookup: UserLookup = {
        findUnique: vi.fn().mockResolvedValue({ role: "USER" }),
      };

      const token: JWT = {};

      const result = await jwtCallback(token, mockUser, mockUserLookup);

      expect(result.role).toBe("USER");
    });

    it("should keep JWT role from DB even when ADMIN_EMAILS contains the user", async () => {
      process.env.ADMIN_EMAILS = "admin@example.com";

      const mockUser: User = {
        id: "user-admin",
        email: "admin@example.com",
        name: "Admin User",
      };

      const mockUserLookup: UserLookup = {
        findUnique: vi.fn().mockResolvedValue({ role: "USER" }),
      };

      const token: JWT = {};
      const result = await jwtCallback(token, mockUser, mockUserLookup);

      expect(result.role).toBe("USER");
    });
  });

  describe("sessionCallback", () => {
    it("should add user id and role to session from token", () => {
      const session: Session = {
        user: {
          id: "",
          email: "test@example.com",
          name: "Test User",
          image: null,
          role: "",
        },
        expires: new Date().toISOString(),
      };

      const token: JWT = {
        id: "user-123",
        role: "ADMIN",
      };

      const result = sessionCallback(session, token);

      expect(result.user.id).toBe("user-123");
      expect(result.user.role).toBe("ADMIN");
    });

    it("should handle USER role in session", () => {
      const session: Session = {
        user: {
          id: "",
          email: "user@example.com",
          name: "Regular User",
          image: null,
          role: "",
        },
        expires: new Date().toISOString(),
      };

      const token: JWT = {
        id: "user-456",
        role: "USER",
      };

      const result = sessionCallback(session, token);

      expect(result.user.id).toBe("user-456");
      expect(result.user.role).toBe("USER");
    });

    it("should keep session role from token even when ADMIN_EMAILS contains the user", () => {
      process.env.ADMIN_EMAILS = "admin@example.com";

      const session: Session = {
        user: {
          id: "",
          email: "admin@example.com",
          name: "Admin User",
          image: null,
          role: "",
        },
        expires: new Date().toISOString(),
      };

      const token: JWT = {
        id: "user-admin",
        role: "USER",
      };

      const result = sessionCallback(session, token);
      expect(result.user.role).toBe("USER");
    });

    it("should preserve other session properties", () => {
      const expires = new Date().toISOString();
      const session: Session = {
        user: {
          id: "",
          email: "preserve@example.com",
          name: "Preserve User",
          image: "https://example.com/avatar.jpg",
          role: "",
        },
        expires,
      };

      const token: JWT = {
        id: "user-789",
        role: "ADMIN",
      };

      const result = sessionCallback(session, token);

      expect(result.user.email).toBe("preserve@example.com");
      expect(result.user.name).toBe("Preserve User");
      expect(result.user.image).toBe("https://example.com/avatar.jpg");
      expect(result.expires).toBe(expires);
    });

    it("should handle session without user gracefully", () => {
      const session = {
        expires: new Date().toISOString(),
      } as Session;

      const token: JWT = {
        id: "user-123",
        role: "ADMIN",
      };

      const result = sessionCallback(session, token);

      // Session user is undefined, so nothing should be set
      expect(result).toBe(session);
    });
  });
});
