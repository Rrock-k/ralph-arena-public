import "server-only";

import type { ProjectInteractionVisualEvidenceReview } from "@arena/contracts";
import { getProjectVisualEvidenceArtifactForDownload } from "@/lib/project-interaction";

export async function buildProjectVisualEvidenceArtifactCheck(input: {
  projectId: string;
  reviews: ProjectInteractionVisualEvidenceReview[];
}) {
  const reviews = await Promise.all(input.reviews.map((review) =>
    checkVisualEvidenceArtifact({
      projectId: input.projectId,
      review,
    })
  ));
  const downloadableCount = reviews.filter((check) => check.download.status === "downloadable").length;
  const notDownloadableCount = reviews.length - downloadableCount;
  return {
    artifactCheck: {
      status: reviews.length === 0
        ? "not_available"
        : downloadableCount === 0 ? "not_downloadable"
          : notDownloadableCount === 0 ? "available" : "partial",
      reviewCount: reviews.length,
      downloadableCount,
      notDownloadableCount,
    },
    reviews,
    evidenceNotes: [
      "Artifact checks are read from current ProjectInteractionSnapshot visualEvidenceReviews only.",
      "Downloadability is verified through getProjectVisualEvidenceArtifactForDownload; response omits raw bytes and storage paths.",
    ],
  };
}

async function checkVisualEvidenceArtifact(input: {
  projectId: string;
  review: ProjectInteractionVisualEvidenceReview;
}) {
  const declared = input.review.artifact;
  const base = {
    reviewId: input.review.id,
    taskId: input.review.taskId,
    taskLabel: input.review.taskLabel,
    status: input.review.status,
    actionHref: input.review.action.href,
    sourceEvidenceRef: input.review.sourceEvidenceRef,
    feedbackItemIds: input.review.feedbackItemIds,
    diffItemIds: input.review.diffItemIds,
    artifact: {
      availability: declared.availability,
      contentType: declared.contentType,
      sha256: declared.sha256,
      unavailableReason: declared.unavailableReason,
    },
  };

  if (declared.availability !== "available") {
    return {
      ...base,
      download: {
        status: "not_downloadable",
        reasonCode: "artifact_unavailable",
        contentType: null,
        sha256: null,
        byteLength: null,
      },
    };
  }

  try {
    const downloaded = await getProjectVisualEvidenceArtifactForDownload({
      projectId: input.projectId,
      reviewId: input.review.id,
    });

    if (!downloaded) {
      return {
        ...base,
        download: {
          status: "not_downloadable",
          reasonCode: "download_owner_returned_null",
          contentType: null,
          sha256: null,
          byteLength: null,
        },
      };
    }

    return {
      ...base,
      download: {
        status: "downloadable",
        reasonCode: null,
        contentType: downloaded.contentType,
        sha256: downloaded.sha256,
        byteLength: downloaded.bytes.byteLength,
      },
    };
  } catch {
    return {
      ...base,
      download: {
        status: "not_downloadable",
        reasonCode: "download_owner_error",
        contentType: null,
        sha256: null,
        byteLength: null,
      },
    };
  }
}
