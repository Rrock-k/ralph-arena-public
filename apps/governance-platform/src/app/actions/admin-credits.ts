"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getFreemiusCheckoutMode } from "@/lib/freemius-checkout-mode";
import { requirePlatformCapability } from "@/lib/platform-access";
import { getUserCreditLedgerHistory, type UserCreditLedgerEntry } from "./credits";

export type AdminCreditAccount = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  };
  balance: number;
  purchasedCredits: number;
  adminGrantedCredits: number;
  reservedCredits: number;
  lastActivityAt: Date | null;
  ledger: UserCreditLedgerEntry[];
};

export type AdminCreditsSnapshot = {
  checkoutMode: "live" | "sandbox";
  accounts: AdminCreditAccount[];
};

export type AdminGrantCreditsResult =
  | { success: true; credits: number }
  | { success: false; error: string };

function summarizeLedger(ledger: UserCreditLedgerEntry[]) {
  return ledger.reduce(
    (acc, entry) => {
      if (entry.source === "purchase") acc.purchasedCredits += entry.creditsDelta;
      if (entry.source === "admin") acc.adminGrantedCredits += entry.creditsDelta;
      if (entry.source === "project_reserve") acc.reservedCredits += Math.abs(entry.creditsDelta);
      return acc;
    },
    { purchasedCredits: 0, adminGrantedCredits: 0, reservedCredits: 0 },
  );
}

export async function listAdminCreditAccounts(): Promise<AdminCreditsSnapshot> {
  const users = await (prisma as any).user.findMany({
    orderBy: [{ email: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      creditBalance: { select: { credits: true } },
    },
  });

  const accounts = await Promise.all(
    users.map(async (user: any) => {
      const ledger = await getUserCreditLedgerHistory(user.id, 30, { includeActor: true });
      const summary = summarizeLedger(ledger);
      return {
        user: {
          id: user.id,
          name: user.name ?? null,
          email: user.email ?? null,
          role: user.role,
        },
        balance: user.creditBalance?.credits ?? 0,
        ...summary,
        lastActivityAt: ledger[0]?.createdAt ?? null,
        ledger,
      };
    }),
  );

  accounts.sort((left, right) => {
    if (right.balance !== left.balance) return right.balance - left.balance;
    return (right.lastActivityAt?.getTime() ?? 0) - (left.lastActivityAt?.getTime() ?? 0);
  });

  return {
    checkoutMode: getFreemiusCheckoutMode(),
    accounts,
  };
}

export async function adminGrantUserCredits(input: {
  userId: string;
  amountUsd: number;
  note: string;
}): Promise<AdminGrantCreditsResult> {
  const access = await requirePlatformCapability("platform.finance.manage");
  if (!access.authorized) {
    return { success: false, error: access.error };
  }

  const actorId = access.session?.user?.id;
  if (!actorId) {
    return { success: false, error: "Signed-in finance admin required." };
  }

  const userId = input.userId?.trim();
  if (!userId) return { success: false, error: "User is required." };

  const amountUsd = Math.round(Number(input.amountUsd) * 100) / 100;
  if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
    return { success: false, error: "Enter a positive credit amount." };
  }

  const note = input.note?.trim();
  if (!note || note.length < 3) {
    return { success: false, error: "A note is required for admin credit grants." };
  }
  if (note.length > 500) {
    return { success: false, error: "Note must be 500 characters or fewer." };
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!targetUser) {
    return { success: false, error: "User not found." };
  }

  const balance = await prisma.$transaction(async (tx) => {
    await (tx as any).userCreditAdjustment.create({
      data: {
        userId,
        createdById: actorId,
        amountUsd,
        kind: "ADMIN_CREDIT_GRANT",
        note,
      },
    });

    return (tx as any).userCreditBalance.upsert({
      where: { userId },
      create: { userId, credits: amountUsd },
      update: { credits: { increment: amountUsd } },
      select: { credits: true },
    });
  });

  revalidatePath("/admin");
  revalidatePath("/credits");

  return { success: true, credits: balance.credits };
}
