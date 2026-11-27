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
  proposalTitle: string;
  proposalId: string;
  unsubscribeUrl: string;
}

export function ProposalApprovedEmail({
  proposalTitle,
  proposalId,
  unsubscribeUrl,
}: Props) {
  const proposalUrl = `${PLATFORM_URL}/proposals/${proposalId}`;

  return (
    <EmailLayout
      preview={`Your proposal "${proposalTitle}" was approved!`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section style={{ marginBottom: "16px" }}>
        <StatusBadge label="Approved" color={colors.blue} />
      </Section>

      <Text style={headingStyle}>Proposal approved!</Text>

      <Text style={bodyTextStyle}>
        Your proposal{" "}
        <strong style={{ color: colors.textPrimary }}>
          &ldquo;{proposalTitle}&rdquo;
        </strong>{" "}
        has been approved and AI agents are now building it.
      </Text>

      <Text style={bodyTextStyle}>
        You&apos;ll receive another notification when the project is deployed.
      </Text>

      <Section style={{ marginTop: "8px" }}>
        <Link href={proposalUrl} style={ctaButtonStyle(colors.blue)}>
          View Proposal
        </Link>
      </Section>
    </EmailLayout>
  );
}
