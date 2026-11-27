export interface AuthFailureDecisionInput {
  attemptAuthVersion?: string | null;
  refreshedAuthVersion?: string | null;
  hasRelevantFreshAuth: boolean;
  attemptedAuthVersions?: Iterable<string>;
}

export type AuthFailureDecision =
  | {
      action: "retry_now";
      authVersion: string;
      reasonMessage: string;
    }
  | {
      action: "pause";
      reasonCode: "auth_expired";
      reasonMessage: string;
    };

export function decideAuthFailureAction(input: AuthFailureDecisionInput): AuthFailureDecision {
  const attempted = new Set(input.attemptedAuthVersions ?? []);
  const refreshedAuthVersion = input.refreshedAuthVersion?.trim() || "";
  const attemptAuthVersion = input.attemptAuthVersion?.trim() || "";

  if (!input.hasRelevantFreshAuth) {
    return {
      action: "pause",
      reasonCode: "auth_expired",
      reasonMessage: "Auth token expired. Waiting for token refresh.",
    };
  }

  if (!refreshedAuthVersion || refreshedAuthVersion === attemptAuthVersion) {
    return {
      action: "pause",
      reasonCode: "auth_expired",
      reasonMessage: "Auth token expired and no newer auth snapshot is available yet.",
    };
  }

  if (attempted.has(refreshedAuthVersion)) {
    return {
      action: "pause",
      reasonCode: "auth_expired",
      reasonMessage: "Auth token expired and the newest auth snapshot already failed. Waiting for another refresh.",
    };
  }

  return {
    action: "retry_now",
    authVersion: refreshedAuthVersion,
    reasonMessage: "Auth token expired but a newer auth snapshot is available. Restarting agent immediately.",
  };
}
