export type TelegramAccountAuditSeverity = "warning" | "info";

export type TelegramAccountAuditBucketCode =
  | "subject_only"
  | "compatibility_alias"
  | "multiple_raw_ids";

export interface TelegramAccountAuditExample {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  rawIds: string[];
  legacyIds: string[];
}

export interface TelegramAccountAuditBucket {
  code: TelegramAccountAuditBucketCode;
  severity: TelegramAccountAuditSeverity;
  title: string;
  effect: string;
  action: string;
  count: number;
  examples: TelegramAccountAuditExample[];
}

export interface TelegramAccountAuditSnapshot {
  generatedAt: string;
  totalTelegramAccounts: number;
  totalTelegramUsers: number;
  rawIdAccountCount: number;
  legacyAccountCount: number;
  warningCount: number;
  buckets: TelegramAccountAuditBucket[];
}
