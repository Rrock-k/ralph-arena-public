import type { Metadata } from "next";
import { getProjectDescription, getProjectName } from "@/lib/project-identity";

export const REDACTED_PROJECT_SHARE_TITLE = "Project — Ralph Arena";
export const REDACTED_PROJECT_SHARE_DESCRIPTION =
  "Project details are available to authorized Ralph Arena users.";

type ProjectShareMetadataInput = {
  id: string;
  name?: string | null;
  proposal?: {
    title?: string | null;
    description?: string | null;
  } | null;
};

export function buildProjectPageMetadata(
  project: ProjectShareMetadataInput,
  canShareDetails: boolean,
): Metadata {
  if (!canShareDetails) {
    return {
      title: REDACTED_PROJECT_SHARE_TITLE,
      description: REDACTED_PROJECT_SHARE_DESCRIPTION,
      openGraph: {
        title: REDACTED_PROJECT_SHARE_TITLE,
        description: REDACTED_PROJECT_SHARE_DESCRIPTION,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: REDACTED_PROJECT_SHARE_TITLE,
        description: REDACTED_PROJECT_SHARE_DESCRIPTION,
      },
    };
  }

  const name = getProjectName(project);
  const description =
    getProjectDescription(project) || "AI-built project on Ralph Arena";

  return {
    title: `${name} — Ralph Arena`,
    description,
    openGraph: {
      title: name,
      description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description,
    },
  };
}

export function buildProjectOgCopy(
  project: ProjectShareMetadataInput,
  canShareDetails: boolean,
) {
  if (!canShareDetails) {
    return {
      canShareDetails: false,
      title: "Project access required",
      description: REDACTED_PROJECT_SHARE_DESCRIPTION,
    };
  }

  const name = getProjectName(project);
  const rawDescription = getProjectDescription(project) || "";
  return {
    canShareDetails: true,
    title: name.length > 80 ? `${name.slice(0, 77)}...` : name,
    description: rawDescription.length > 150
      ? `${rawDescription.slice(0, 147)}...`
      : rawDescription,
  };
}
