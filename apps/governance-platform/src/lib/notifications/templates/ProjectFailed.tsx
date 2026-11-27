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
  error?: string;
  unsubscribeUrl: string;
}

export function ProjectFailedEmail({
  projectName,
  projectId,
  error,
  unsubscribeUrl,
}: Props) {
  const projectUrl = `${PLATFORM_URL}/projects/${projectId}`;

  return (
    <EmailLayout
      preview={`${projectName} failed`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Section style={{ marginBottom: "16px" }}>
        <StatusBadge label="Failed" color={colors.rose} />
      </Section>

      <Text style={headingStyle}>Project build failed</Text>

      <Text style={bodyTextStyle}>
        <strong style={{ color: colors.textPrimary }}>{projectName}</strong>{" "}
        encountered an error and could not complete.
      </Text>

      {error && (
        <Section
          style={{
            backgroundColor: "#1a1225",
            border: `1px solid ${colors.rose}30`,
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "20px",
          }}
        >
          <Text
            style={{
              fontSize: "13px",
              fontFamily: "monospace",
              color: colors.rose,
              margin: 0,
              wordBreak: "break-word",
            }}
          >
            {error.length > 300 ? `${error.slice(0, 300)}...` : error}
          </Text>
        </Section>
      )}

      <Section style={{ marginTop: "8px" }}>
        <Link href={projectUrl} style={ctaButtonStyle(colors.rose)}>
          View Logs
        </Link>
      </Section>
    </EmailLayout>
  );
}
