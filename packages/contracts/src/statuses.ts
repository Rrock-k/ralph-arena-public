import { z } from "zod";

export const TerminalStatusSchema = z.enum([
  "DEPLOYED",
  "FAILED",
  "CANCELED",
]);

export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;

export function isTerminalStatus(status: string): status is TerminalStatus {
  return TerminalStatusSchema.safeParse(status).success;
}

export function isActiveStatus(status: string): boolean {
  return (
    status === "PROVISIONING" ||
    status === "QUEUED" ||
    status === "RUNNING" ||
    status === "PAUSING"
  );
}
