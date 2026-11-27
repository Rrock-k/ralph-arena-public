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

interface Props {
  projectName: string;
  projectId: string;
  unsubscribeUrl: string;
}

export function ProjectPausedBudgetEmail({
  projectName,
  projectId,
  unsubscribeUrl,
}: Props) {
  const projectUrl = `${PLATFORM_URL}/projects/${projectId}`;

  return (
    <EmailLayout
      preview={`${projectName} paused — budget exhausted`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section style={{ marginBottom: "16px" }}>
        <StatusBadge label="Budget Exhausted" color={colors.amber} />
      </Section>

      <Text style={headingStyle}>Project paused</Text>

      <Text style={bodyTextStyle}>
        <strong style={{ color: colors.textPrimary }}>{projectName}</strong> has
        been automatically paused because the allocated budget has been
        exhausted.
      </Text>

      <Text style={bodyTextStyle}>
        You can increase the budget to resume the project, or leave it paused.
      </Text>

      <Section style={{ marginTop: "8px" }}>
        <Link href={projectUrl} style={ctaButtonStyle(colors.amber)}>
          Manage Budget
        </Link>
      </Section>
    </EmailLayout>
  );
}
