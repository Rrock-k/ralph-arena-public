import { describe, expect, it } from "vitest";
import {
  REDACTED_PROJECT_SHARE_DESCRIPTION,
  REDACTED_PROJECT_SHARE_TITLE,
  buildProjectOgCopy,
  buildProjectPageMetadata,
} from "./project-share-metadata";

const privateProject = {
  id: "project-private",
  name: "Secret Product",
  proposal: {
    title: "Secret Proposal",
    description: "Private implementation details",
  },
};

describe("project share metadata", () => {
  it("redacts page metadata when the viewer cannot access the project", () => {
    expect(buildProjectPageMetadata(privateProject, false)).toEqual({
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
    });
  });

  it("uses project details only when the viewer can access the project", () => {
    expect(buildProjectPageMetadata(privateProject, true)).toMatchObject({
      title: "Secret Product — Ralph Arena",
      description: "Private implementation details",
      openGraph: {
        title: "Secret Product",
        description: "Private implementation details",
      },
    });
  });

  it("redacts OG copy when access is denied", () => {
    expect(buildProjectOgCopy(privateProject, false)).toEqual({
      canShareDetails: false,
      title: "Project access required",
      description: REDACTED_PROJECT_SHARE_DESCRIPTION,
    });
  });
});
