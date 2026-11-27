import { describe, expect, it } from "vitest";
import {
  ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
  SPEC_DOCUMENT_SCHEMA_VERSION,
  AcceptedSpecArtifactSchema,
  FeedbackItemSchema,
  acceptedSpecArtifactRequiresLoopWork,
  acceptFeedbackClosed,
  feedbackHasLoopClaim,
  feedbackIsProductClosed,
  feedbackRequiresLoopWork,
  findAcceptedSpecArtifactSecurityFindings,
  markFeedbackHandled,
  parseAcceptedSpecArtifact,
  reopenFeedback,
  renderSpecDocumentMarkdown,
  supersedeFeedback,
} from "../index.js";

function validArtifact() {
  return {
    artifactSchemaVersion: ACCEPTED_SPEC_ARTIFACT_SCHEMA_VERSION,
    artifactId: "SPEC-20260516-001",
    acceptedAt: "2026-05-16T12:00:00Z",
    source: {
      id: "SRC-001",
      sourceSystem: "tg-spec",
      sourceProjectId: "tg-proj-1",
      sourceVersion: 12,
      sourceRefType: "accepted_spec",
      sourceId: "tg-spec-version-12",
      fingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    acceptedSpec: {
      id: "SPEC-001",
      version: 12,
      document: {
        specSchemaVersion: SPEC_DOCUMENT_SCHEMA_VERSION,
        title: "Product Spec",
        summary: "Build the approved app.",
        sections: [{
          id: "SPEC-SECTION-001",
          title: "Core App",
          body: "The app must follow the accepted product direction.",
          requirementIds: ["REQ-001"],
          sourceRefs: ["SRC-001"],
        }],
        requirements: [{
          id: "REQ-001",
          kind: "functional",
          title: "Approved app shell",
          statement: "Build the approved app.",
          priority: "high",
          acceptanceCriteria: ["The app opens from the preview URL."],
          sourceRefs: ["SRC-001"],
        }],
        extensionBlocks: [],
      },
      renderedMarkdown: "# Product Spec\n\nBuild the approved app.",
      contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      sourceRefs: ["SRC-001"],
    },
    acceptedDiff: {
      id: "DIFF-012",
      baseSpecVersion: 11,
      targetSpecVersion: 12,
      summary: "BUG-006 reopened after users reported the issue still happens.",
      items: [{
        id: "DIFF-012-001",
        targetType: "feedback",
        targetId: "BUG-006",
        changeType: "reopened",
        workImpact: "requires_loop_work",
        workSurface: "frontend",
        summary: "Queue readability is still failing on mobile.",
        sourceRefs: ["SRC-001"],
      }],
    },
    feedback: [{
      id: "BUG-006",
      title: "Queue readability is still failing",
      body: "Users report the queue cards are still too dense on mobile.",
      state: "reopened",
      reopenCount: 2,
      defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
      sourceRefs: ["SRC-001"],
    }],
    assumptions: [{
      id: "ASM-001",
      title: "AI provider for MVP",
      statement: "Use a mocked provider for local smoke only; production requires a real provider key.",
      state: "corrected",
      sourceRefs: ["SRC-001"],
      outcome: {
        kind: "corrected_into_spec",
        acceptedDiffItemId: "DIFF-012-001",
        correctionSummary: "Production generation requires a real provider integration.",
      },
    }],
    secretRequirements: [{
      id: "SEC-OPENAI",
      key: "OPENAI_API_KEY",
      description: "Required for production AI generation.",
      required: true,
      blocking: true,
      sourceRefs: ["SRC-001"],
    }],
    assets: [{
      id: "ASSET-BRAND-LOGO",
      kind: "image",
      label: "Brand logo",
      required: true,
      state: "pending",
      logicalPath: "brand/logo.png",
      contentType: "image/png",
      sha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      sourceRefs: ["SRC-001"],
    }],
  };
}

describe("AcceptedSpecArtifactSchema", () => {
  it("parses a strict loop-neutral artifact", () => {
    const parsed = parseAcceptedSpecArtifact(validArtifact());

    expect("tasks" in parsed).toBe(false);
    expect(parsed.feedback[0]).toMatchObject({
      id: "BUG-006",
      state: "reopened",
      reopenCount: 2,
      defaultClosurePolicy: "loop_claim_is_enough_until_reopened",
    });
  });

  it("rejects unknown top-level and nested fields", () => {
    expect(() => parseAcceptedSpecArtifact({
      ...validArtifact(),
      phases: [],
    })).toThrow();

    expect(() => parseAcceptedSpecArtifact({
      ...validArtifact(),
      tasks: [],
    })).toThrow();
  });

  it("rejects reopened feedback without a reopen count", () => {
    expect(AcceptedSpecArtifactSchema.safeParse({
      ...validArtifact(),
      feedback: [{
        ...validArtifact().feedback[0],
        reopenCount: 0,
      }],
    }).success).toBe(false);
  });

  it("accepts handled feedback as loop-claimed but not accepted closure", () => {
    const artifact = {
      ...validArtifact(),
      acceptedDiff: {
        ...validArtifact().acceptedDiff,
        summary: "BUG-006 was handled by the latest loop pass.",
        items: [{
          ...validArtifact().acceptedDiff.items[0],
          changeType: "handled",
          workImpact: "no_loop_work",
          summary: "Loop claims BUG-006 has been fixed; users have not accepted closure.",
        }],
      },
      feedback: [{
        ...validArtifact().feedback[0],
        state: "handled",
      }],
    };

    const parsed = parseAcceptedSpecArtifact(artifact);
    expect(parsed.feedback[0].state).toBe("handled");
    expect(parsed.feedback[0].resolution).toBeUndefined();
    expect(parsed.acceptedDiff.items[0]).toMatchObject({
      changeType: "handled",
      workImpact: "no_loop_work",
    });
  });

  it("preserves optional work surface on accepted diff items", () => {
    const parsed = parseAcceptedSpecArtifact(validArtifact());

    expect(parsed.acceptedDiff.items[0]).toMatchObject({
      workImpact: "requires_loop_work",
      workSurface: "frontend",
    });
  });

  it("distinguishes implementable accepted diff work from context-only updates", () => {
    expect(acceptedSpecArtifactRequiresLoopWork(parseAcceptedSpecArtifact(validArtifact()))).toBe(true);

    const contextOnly = parseAcceptedSpecArtifact({
      ...validArtifact(),
      acceptedDiff: {
        id: "DIFF-013",
        baseSpecVersion: 12,
        targetSpecVersion: 13,
        summary: "Recorded an assumption.",
        items: [{
          id: "DIFF-013-001",
          targetType: "assumption",
          targetId: "ASM-001",
          changeType: "created",
          workImpact: "context_only",
          summary: "Assumption only.",
          sourceRefs: ["SRC-001"],
        }],
      },
    });

    expect(acceptedSpecArtifactRequiresLoopWork(contextOnly)).toBe(false);
  });

  it("preserves compact source evidence for precise diff intent", () => {
    const artifact = parseAcceptedSpecArtifact({
      ...validArtifact(),
      acceptedDiff: {
        ...validArtifact().acceptedDiff,
        items: [{
          ...validArtifact().acceptedDiff.items[0],
          summary: "Practice play button must use an icon instead of visible text.",
          sourceEvidence: [{
            sourceRef: "SRC-001",
            quote: "кнопку Play не текстом, а той же play-иконкой",
            intent: "The play control is an icon button; visible Play/play text must not remain.",
          }],
        }],
      },
    });

    expect(artifact.acceptedDiff.items[0].sourceEvidence).toEqual([{
      sourceRef: "SRC-001",
      quote: "кнопку Play не текстом, а той же play-иконкой",
      intent: "The play control is an icon button; visible Play/play text must not remain.",
    }]);
  });

  it("rejects source evidence that is detached from diff source refs", () => {
    expect(AcceptedSpecArtifactSchema.safeParse({
      ...validArtifact(),
      acceptedDiff: {
        ...validArtifact().acceptedDiff,
        items: [{
          ...validArtifact().acceptedDiff.items[0],
          sourceEvidence: [{
            sourceRef: "SRC-MISSING",
            intent: "The source ref must be attached to this diff item.",
          }],
        }],
      },
    }).success).toBe(false);

    expect(AcceptedSpecArtifactSchema.safeParse({
      ...validArtifact(),
      acceptedDiff: {
        ...validArtifact().acceptedDiff,
        items: [{
          ...validArtifact().acceptedDiff.items[0],
          sourceEvidence: [{
            sourceRef: "SRC-001",
          }],
        }],
      },
    }).success).toBe(false);
  });

  it("models the feedback lifecycle without a second task entity", () => {
    const feedback = parseAcceptedSpecArtifact(validArtifact()).feedback[0];
    const openFeedback = FeedbackItemSchema.parse({
      ...feedback,
      state: "open",
      reopenCount: 0,
    });

    expect(feedbackRequiresLoopWork({ state: "open" })).toBe(true);
    expect(feedbackRequiresLoopWork(feedback)).toBe(true);

    const firstReopened = reopenFeedback(openFeedback, { sourceRefs: ["SRC-002"] });
    expect(firstReopened).toMatchObject({
      state: "reopened",
      reopenCount: 1,
      sourceRefs: ["SRC-001", "SRC-002"],
    });
    expect(FeedbackItemSchema.safeParse(firstReopened).success).toBe(true);

    const repeatedReopened = reopenFeedback(feedback, { sourceRefs: ["SRC-002"] });
    expect(repeatedReopened).toMatchObject({
      state: "reopened",
      reopenCount: 3,
      sourceRefs: ["SRC-001", "SRC-002"],
    });
    expect(FeedbackItemSchema.safeParse(repeatedReopened).success).toBe(true);

    const handled = markFeedbackHandled(feedback);
    expect(handled).toMatchObject({
      id: "BUG-006",
      state: "handled",
      reopenCount: 2,
    });
    expect(feedbackRequiresLoopWork(handled)).toBe(false);
    expect(feedbackHasLoopClaim(handled)).toBe(true);
    expect(feedbackIsProductClosed(handled)).toBe(false);
    expect(handled.resolution).toBeUndefined();
    expect(FeedbackItemSchema.safeParse(handled).success).toBe(true);

    const acceptedClosed = acceptFeedbackClosed(handled, {
      summary: "User accepted that BUG-006 is fixed.",
      sourceRefs: ["SRC-002"],
    });
    expect(acceptedClosed).toMatchObject({
      state: "accepted_closed",
      resolution: {
        kind: "accepted_fixed",
        summary: "User accepted that BUG-006 is fixed.",
        sourceRefs: ["SRC-002"],
      },
    });
    expect(feedbackRequiresLoopWork(acceptedClosed)).toBe(false);
    expect(feedbackHasLoopClaim(acceptedClosed)).toBe(false);
    expect(feedbackIsProductClosed(acceptedClosed)).toBe(true);
    expect(FeedbackItemSchema.safeParse(acceptedClosed).success).toBe(true);
    expect(() => acceptFeedbackClosed(acceptedClosed, {
      summary: "User accepted that BUG-006 is fixed.",
      sourceRefs: ["SRC-002"],
    })).toThrow(/Cannot accept closed feedback BUG-006/);

    const reopened = reopenFeedback(acceptedClosed, {
      body: "Users report BUG-006 still happens after the loop claim.",
      sourceRefs: ["SRC-003"],
    });
    expect(reopened).toMatchObject({
      state: "reopened",
      reopenCount: 3,
      body: "Users report BUG-006 still happens after the loop claim.",
      sourceRefs: ["SRC-001", "SRC-003"],
    });
    expect(reopened.resolution).toBeUndefined();
    expect(feedbackRequiresLoopWork(reopened)).toBe(true);
    expect(FeedbackItemSchema.safeParse(reopened).success).toBe(true);
  });

  it("keeps illegal feedback transitions explicit", () => {
    const feedback = parseAcceptedSpecArtifact(validArtifact()).feedback[0];
    const superseded = supersedeFeedback(feedback, {
      summary: "The old issue was replaced by a newer accepted requirement.",
      sourceRefs: ["SRC-002"],
    });

    expect(feedbackIsProductClosed(superseded)).toBe(true);
    expect(superseded.resolution).toMatchObject({
      kind: "superseded",
      sourceRefs: ["SRC-002"],
    });
    expect(() => markFeedbackHandled(superseded)).toThrow(/Cannot mark handled feedback BUG-006/);
    expect(() => reopenFeedback(superseded, { sourceRefs: ["SRC-003"] })).toThrow(/Cannot reopen feedback BUG-006/);
    expect(() => supersedeFeedback(superseded, {
      summary: "Already superseded.",
      sourceRefs: ["SRC-003"],
    })).toThrow(/Cannot supersede feedback BUG-006/);
  });

  it("validates helper transition inputs before returning feedback", () => {
    const feedback = parseAcceptedSpecArtifact(validArtifact()).feedback[0];
    const handled = markFeedbackHandled(feedback);

    expect(() => acceptFeedbackClosed(handled, {
      summary: "",
      sourceRefs: ["SRC-002"],
    })).toThrow();

    expect(() => reopenFeedback(handled, {
      body: "",
      sourceRefs: ["SRC-002"],
    })).toThrow();

    expect(() => supersedeFeedback(handled, {
      summary: "The old issue was replaced.",
      sourceRefs: ["not-a-valid-ref"],
    })).toThrow();
  });

  it("rejects forbidden secret-like fields and values", () => {
    expect(() => parseAcceptedSpecArtifact({
      ...validArtifact(),
      secretRequirements: [{
        ...validArtifact().secretRequirements[0],
        token: "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      }],
    })).toThrow(/forbidden_field_name/);

    expect(AcceptedSpecArtifactSchema.safeParse({
      ...validArtifact(),
      acceptedSpec: {
        ...validArtifact().acceptedSpec,
        document: {
          ...validArtifact().acceptedSpec.document,
          requirements: [{
            ...validArtifact().acceptedSpec.document.requirements[0],
            statement: "Use sk-proj-abcdefghijklmnopqrstuvwxyz123456 in production.",
          }],
        },
      },
    }).success).toBe(false);
  });

  it("reports security findings without treating secret names as secret values", () => {
    const findings = findAcceptedSpecArtifactSecurityFindings(validArtifact());
    expect(findings).toEqual([]);
  });

  it("renders strict spec document markdown as a library helper", () => {
    const markdown = renderSpecDocumentMarkdown(parseAcceptedSpecArtifact(validArtifact()).acceptedSpec.document);

    expect(markdown).toContain("# Product Spec");
    expect(markdown).toContain("## Core App");
    expect(markdown).toContain("REQ-001: Approved app shell");
  });
});
