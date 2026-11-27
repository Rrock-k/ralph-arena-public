/**
 * RA-224: Shared email template components and styles.
 *
 * Design: dark theme matching platform (#0b0f19 base), minimal,
 * mobile-friendly, with consistent branding.
 */

import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Text,
  Link,
  Hr,
  Preview,
  Section,
  Img,
} from "@react-email/components";

// ── Brand constants ─────────────────────────────────────────────

const PLATFORM_URL = process.env.NEXTAUTH_URL || "https://arena.example.test";

const colors = {
  bg: "#0b0f19",
  card: "#131827",
  border: "#1e293b",
  textPrimary: "#e2e8f0",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  emerald: "#10b981",
  rose: "#f43f5e",
  amber: "#f59e0b",
  blue: "#3b82f6",
  link: "#38bdf8",
};

// ── Shared styles ───────────────────────────────────────────────

export const baseBodyStyle: React.CSSProperties = {
  backgroundColor: colors.bg,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  margin: 0,
  padding: 0,
};

export const containerStyle: React.CSSProperties = {
  maxWidth: "520px",
  margin: "0 auto",
  padding: "40px 24px",
};

export const cardStyle: React.CSSProperties = {
  backgroundColor: colors.card,
  borderRadius: "12px",
  border: `1px solid ${colors.border}`,
  padding: "32px",
};

export const headingStyle: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  color: colors.textPrimary,
  lineHeight: "1.3",
  margin: "0 0 12px 0",
};

export const bodyTextStyle: React.CSSProperties = {
  fontSize: "15px",
  lineHeight: "1.6",
  color: colors.textSecondary,
  margin: "0 0 20px 0",
};

export const ctaButtonStyle = (color: string): React.CSSProperties => ({
  display: "inline-block",
  backgroundColor: color,
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  padding: "12px 28px",
  borderRadius: "8px",
  textDecoration: "none",
  textAlign: "center",
});

export const footerTextStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "1.5",
  color: colors.textMuted,
  margin: "0",
};

export const hrStyle: React.CSSProperties = {
  borderColor: colors.border,
  margin: "24px 0",
};

// ── Shared components ───────────────────────────────────────────

export function EmailLayout({
  preview,
  children,
  unsubscribeUrl,
}: {
  preview: string;
  children: React.ReactNode;
  unsubscribeUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={baseBodyStyle}>
        <Container style={containerStyle}>
          {/* Header — brand */}
          <Section style={{ marginBottom: "24px" }}>
            <Text
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: colors.textPrimary,
                letterSpacing: "-0.02em",
              }}
            >
              Ralph Arena
            </Text>
          </Section>

          {/* Main content card */}
          <Section style={cardStyle}>{children}</Section>

          {/* Footer */}
          <Section style={{ marginTop: "24px" }}>
            <Hr style={hrStyle} />
            <Text style={footerTextStyle}>
              You received this because of your activity on{" "}
              <Link href={PLATFORM_URL} style={{ color: colors.link }}>
                Ralph Arena
              </Link>
              .
            </Text>
            <Text style={{ ...footerTextStyle, marginTop: "8px" }}>
              <Link href={unsubscribeUrl} style={{ color: colors.textMuted }}>
                Unsubscribe from these emails
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function StatusBadge({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        backgroundColor: `${color}20`,
        color,
        fontSize: "12px",
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: "6px",
        letterSpacing: "0.03em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

export { colors, PLATFORM_URL };
