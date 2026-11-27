import * as React from "react";
import { Text, Link, Section } from "@react-email/components";
import {
  EmailLayout,
  StatusBadge,
  headingStyle,
  bodyTextStyle,
  ctaButtonStyle,
  colors,
  PLATFORM_URL,
} from "./shared";
import { getProjectPreviewOpenHref } from "@/lib/preview-url";

interface Props {
  projectName: string;
  projectId: string;
  previewUrl?: string;
  unsubscribeUrl: string;
}

export function ProjectDeployedEmail({
  projectName,
  projectId,
  previewUrl,
  unsubscribeUrl,
}: Props) {
  const projectUrl = `${PLATFORM_URL}/projects/${projectId}`;
  const previewHref = previewUrl
    ? getProjectPreviewOpenHref(projectId, PLATFORM_URL)
    : null;

  return (
    <EmailLayout
      preview={`${projectName} is live!`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section style={{ marginBottom: "16px" }}>
        <StatusBadge label="Deployed" color={colors.emerald} />
      </Section>

      <Text style={headingStyle}>Your project is live!</Text>

      <Text style={bodyTextStyle}>
        <strong style={{ color: colors.textPrimary }}>{projectName}</strong> has
        been successfully deployed and is now accessible.
      </Text>

      {previewHref && (
        <Text style={bodyTextStyle}>
          Preview:{" "}
          <Link href={previewHref} style={{ color: colors.link }}>
            Open preview
          </Link>
        </Text>
      )}

      <Section style={{ marginTop: "8px" }}>
        <Link href={projectUrl} style={ctaButtonStyle(colors.emerald)}>
          View Project
        </Link>
      </Section>
    </EmailLayout>
  );
}
