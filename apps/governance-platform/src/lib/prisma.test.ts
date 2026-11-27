import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const testDatabaseUrl =
  process.env.VITEST_DATABASE_URL?.trim() ||
  process.env.PLAYWRIGHT_DATABASE_URL?.trim() ||
  "";

function isSafeTestDatabaseUrl(url: string): boolean {
  if (!url) return false;
  if (process.env.ALLOW_UNSAFE_DB_TESTS === "1") return true;
  return /(_test|_e2e)(\b|$)/i.test(url);
}

const hasTestDb = isSafeTestDatabaseUrl(testDatabaseUrl);

const adapter = hasTestDb
  ? new PrismaPg({ connectionString: testDatabaseUrl })
  : (null as any);

const prisma = hasTestDb
  ? new PrismaClient({ adapter })
  : (null as any);

describe.skipIf(!hasTestDb)("Prisma Client", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up database before each test
    // Delete in order respecting foreign key constraints
    await prisma.vote.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.proposal.deleteMany();
    await prisma.user.deleteMany();
    await prisma.verificationToken.deleteMany();
  });

  describe("Connection", () => {
    it("should connect to the database", async () => {
      const result = await prisma.$queryRaw`SELECT 1 as test`;
      expect(result).toBeDefined();
    });
  });

  describe("User Model", () => {
    it("should create a user", async () => {
      const user = await prisma.user.create({
        data: {
          email: "test@example.com",
          name: "Test User",
          role: "USER",
        },
      });

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe("test@example.com");
      expect(user.name).toBe("Test User");
      expect(user.role).toBe("USER");
    });

    it("should enforce unique email constraint", async () => {
      await prisma.user.create({
        data: {
          email: "duplicate@example.com",
          name: "User 1",
        },
      });

      await expect(
        prisma.user.create({
          data: {
            email: "duplicate@example.com",
            name: "User 2",
          },
        })
      ).rejects.toThrow();
    });

    it("should allow first-class users without email", async () => {
      const [first, second] = await Promise.all([
        prisma.user.create({
          data: {
            email: null,
            name: "Telegram User 1",
          },
        }),
        prisma.user.create({
          data: {
            email: null,
            name: "Telegram User 2",
          },
        }),
      ]);

      expect(first.email).toBeNull();
      expect(second.email).toBeNull();
    });

    it("should default role to USER", async () => {
      const user = await prisma.user.create({
        data: {
          email: "default@example.com",
        },
      });

      expect(user.role).toBe("USER");
    });

    it("should allow ADMIN role", async () => {
      const admin = await prisma.user.create({
        data: {
          email: "admin@example.com",
          name: "Admin User",
          role: "ADMIN",
        },
      });

      expect(admin.role).toBe("ADMIN");
    });
  });

  describe("Proposal Model", () => {
    it("should create a proposal", async () => {
      const proposal = await prisma.proposal.create({
        data: {
          title: "Test Proposal",
          description: "A test proposal description",
          spec: "# Spec\n\nMarkdown content here.",
        },
      });

      expect(proposal).toBeDefined();
      expect(proposal.id).toBeDefined();
      expect(proposal.title).toBe("Test Proposal");
      expect(proposal.description).toBe("A test proposal description");
      expect(proposal.spec).toBe("# Spec\n\nMarkdown content here.");
      expect(proposal.status).toBe("PROPOSED");
      expect(proposal.createdAt).toBeInstanceOf(Date);
    });

    it("should default status to PROPOSED", async () => {
      const proposal = await prisma.proposal.create({
        data: {
          title: "Default Status Proposal",
          description: "Testing default status",
          spec: "# Spec",
        },
      });

      expect(proposal.status).toBe("PROPOSED");
    });
  });

  describe("Vote Model", () => {
    it("should create a vote linking user and proposal", async () => {
      const user = await prisma.user.create({
        data: {
          email: "voter@example.com",
          name: "Voter",
        },
      });

      const proposal = await prisma.proposal.create({
        data: {
          title: "Voteable Proposal",
          description: "A proposal to vote on",
          spec: "# Spec",
        },
      });

      const vote = await prisma.vote.create({
        data: {
          userId: user.id,
          proposalId: proposal.id,
        },
      });

      expect(vote).toBeDefined();
      expect(vote.id).toBeDefined();
      expect(vote.userId).toBe(user.id);
      expect(vote.proposalId).toBe(proposal.id);
    });

    it("should enforce unique userId-proposalId constraint", async () => {
      const user = await prisma.user.create({
        data: {
          email: "unique-voter@example.com",
          name: "Unique Voter",
        },
      });

      const proposal = await prisma.proposal.create({
        data: {
          title: "Single Vote Proposal",
          description: "Can only vote once",
          spec: "# Spec",
        },
      });

      await prisma.vote.create({
        data: {
          userId: user.id,
          proposalId: proposal.id,
        },
      });

      await expect(
        prisma.vote.create({
          data: {
            userId: user.id,
            proposalId: proposal.id,
          },
        })
      ).rejects.toThrow();
    });

    it("should allow same user to vote on different proposals", async () => {
      const user = await prisma.user.create({
        data: {
          email: "multi-voter@example.com",
          name: "Multi Voter",
        },
      });

      const proposal1 = await prisma.proposal.create({
        data: {
          title: "Proposal 1",
          description: "First proposal",
          spec: "# Spec",
        },
      });

      const proposal2 = await prisma.proposal.create({
        data: {
          title: "Proposal 2",
          description: "Second proposal",
          spec: "# Spec",
        },
      });

      const vote1 = await prisma.vote.create({
        data: {
          userId: user.id,
          proposalId: proposal1.id,
        },
      });

      const vote2 = await prisma.vote.create({
        data: {
          userId: user.id,
          proposalId: proposal2.id,
        },
      });

      expect(vote1.proposalId).toBe(proposal1.id);
      expect(vote2.proposalId).toBe(proposal2.id);
    });

    it("should include votes when querying user with relations", async () => {
      const user = await prisma.user.create({
        data: {
          email: "related@example.com",
          name: "Related User",
        },
      });

      const proposal = await prisma.proposal.create({
        data: {
          title: "Related Proposal",
          description: "Testing relations",
          spec: "# Spec",
        },
      });

      await prisma.vote.create({
        data: {
          userId: user.id,
          proposalId: proposal.id,
        },
      });

      const userWithVotes = await prisma.user.findUnique({
        where: { id: user.id },
        include: { votes: true },
      });

      expect(userWithVotes?.votes).toHaveLength(1);
      expect(userWithVotes?.votes[0].proposalId).toBe(proposal.id);
    });

    it("should include votes when querying proposal with relations", async () => {
      const user = await prisma.user.create({
        data: {
          email: "proposal-voter@example.com",
          name: "Proposal Voter",
        },
      });

      const proposal = await prisma.proposal.create({
        data: {
          title: "Todo List Web App",
          description: "Collaborative todo list with priorities, due dates, and completion tracking",
          spec: `# Todo List Web App

## Goal
Build a simple app where users can create and manage personal tasks.

## Core features
- Create, edit, and delete tasks
- Mark task as completed
- Filter tasks by status (all / active / done)
- Optional due date and priority

## Definition of done
- User can manage tasks from one page
- UI stays responsive on mobile and desktop
- Basic unit tests cover task operations`,
        },
      });

      await prisma.vote.create({
        data: {
          userId: user.id,
          proposalId: proposal.id,
        },
      });

      const proposalWithVotes = await prisma.proposal.findUnique({
        where: { id: proposal.id },
        include: { votes: true },
      });

      expect(proposalWithVotes?.votes).toHaveLength(1);
      expect(proposalWithVotes?.votes[0].userId).toBe(user.id);
    });
  });
});
