import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCronAuthorized } from "@/lib/internal-auth";
import { isCommunityQaEnabled } from "@/lib/feature-flags";

/**
 * POST /api/cron/qa-feedback
 *
 * RA-158: Batch accumulated QA test results and deliver as qa_feedback_batch
 * events to DEPLOYED projects with community_qa capability.
 *
 * For each eligible project:
 * 1. Find all test_result events (direction="in") since last batch
 * 2. Join with original test_request events to build a human-readable summary
 * 3. Create a qa_feedback_batch event (direction="in") for the runner to pick up
 *
 * The runner's EventSync polls incoming events and writes them to events.json.
 * The loop reads events.json and decides how to react.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RA-243: Respect platform feature flag — skip entirely when community_qa is off
  if (!(await isCommunityQaEnabled())) {
    return NextResponse.json({ processed: 0, message: "community_qa feature flag is off" });
  }

  // Find projects with agentState IDLE+COMPLETED outcome (deployed) or RUNNING, with community_qa capability
  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      components: {
        some: {
          kind: "app",
          OR: [
            { agentState: "RUNNING" },
            { agentState: "IDLE", lastOutcome: "COMPLETED" },
          ],
        },
      },
      agentLoopVersion: {
        capabilities: { has: "community_qa" },
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!projects.length) {
    return NextResponse.json({ processed: 0, message: "No eligible projects" });
  }

  let batchesCreated = 0;

  for (const project of projects) {
    // Find the last qa_feedback_batch we sent (to avoid re-sending)
    const lastBatch = await (prisma as any).projectEvent.findFirst({
      where: {
        projectId: project.id,
        direction: "in",
        type: "qa_feedback_batch",
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const sinceDate = lastBatch?.createdAt ?? new Date(0);

    // Find test_result events since last batch
    const testResults = await (prisma as any).projectEvent.findMany({
      where: {
        projectId: project.id,
        direction: "in",
        type: "test_result",
        createdAt: { gt: sinceDate },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!testResults.length) continue;

    // Get the corresponding test_request events to resolve titles/questions
    const testRequestIds = new Set<string>();
    for (const tr of testResults) {
      const reqId = tr.payload?.testRequestEventId;
      if (reqId) testRequestIds.add(reqId);
    }

    const testRequests = testRequestIds.size > 0
      ? await (prisma as any).projectEvent.findMany({
          where: {
            id: { in: Array.from(testRequestIds) },
            type: "test_request",
          },
        })
      : [];

    const requestMap = new Map<string, any>();
    for (const req of testRequests) {
      requestMap.set(req.id, req);
    }

    // Build batch summary
    let totalPassed = 0;
    let totalFailed = 0;
    const tests: Array<{
      testTitle: string;
      steps: Array<{ question: string; passed: boolean; comment?: string }>;
    }> = [];

    for (const tr of testResults) {
      const reqEvent = requestMap.get(tr.payload?.testRequestEventId);
      const reqPayload = reqEvent?.payload;
      const results: Array<{ stepIndex: number; passed: boolean; comment?: string }> = tr.payload?.results ?? [];

      const steps = results.map((r) => {
        const question = reqPayload?.steps?.[r.stepIndex]?.question ?? `Step ${r.stepIndex}`;
        if (r.passed) totalPassed++;
        else totalFailed++;
        return {
          question,
          passed: r.passed,
          ...(r.comment ? { comment: r.comment } : {}),
        };
      });

      tests.push({
        testTitle: reqPayload?.title ?? "Unknown test",
        steps,
      });
    }

    const summary = `QA Feedback: ${totalPassed} passed, ${totalFailed} failed across ${tests.length} test(s)`;

    // Create the batch event (direction="in" so runner picks it up)
    await (prisma as any).projectEvent.create({
      data: {
        projectId: project.id,
        direction: "in",
        type: "qa_feedback_batch",
        payload: {
          summary,
          tests,
          totalPassed,
          totalFailed,
        },
      },
    });

    batchesCreated++;
    console.log(`[qa-feedback] Created batch for project ${project.id}: ${summary}`);
  }

  return NextResponse.json({ processed: projects.length, batchesCreated });
}
