import type { JWT } from "next-auth/jwt";
import type { Session, User } from "next-auth";

export interface UserLookup {
  findUnique: (args: { where: { id: string }; select: { role: true } }) => Promise<{ role: string } | null>;
}

/**
 * JWT callback logic - adds user ID and role to the JWT token.
 * Called when a JWT is created or updated.
 */
export async function jwtCallback(
  token: JWT,
  user: User | undefined,
  userLookup: UserLookup
): Promise<JWT> {
  const lookupUserId = user?.id ?? (typeof token.id === "string" ? token.id : undefined) ?? (typeof token.sub === "string" ? token.sub : undefined);
  const userEmail = typeof user?.email === "string" ? user.email : undefined;
  const tokenEmail = typeof token.email === "string" ? token.email : undefined;
  const effectiveEmail = userEmail ?? tokenEmail;

  if (effectiveEmail) {
    token.email = effectiveEmail;
  }

  if (!lookupUserId) {
    return token;
  }

  token.id = lookupUserId;
  const dbUser = await userLookup.findUnique({
    where: { id: lookupUserId },
    select: { role: true },
  });

  // User deleted or DB reseeded → mark token invalid so sessionCallback clears the session
  if (!dbUser && !user) {
    token.invalid = true;
    return token;
  }

  token.role = dbUser?.role ?? (typeof token.role === "string" ? token.role : "USER");
  return token;
}

/**
 * Session callback logic - adds user ID and role to the session.
 * Called whenever a session is checked.
 */
export function sessionCallback(session: Session, token: JWT): Session {
  // Stale token (user missing from DB) → mark session expired so client can sign out with a visible toast
  if (token.invalid) {
    session.expired = true;
    session.user = undefined as any;
    return session;
  }

  if (token && session.user) {
    session.user.id = (token.id ?? token.sub) as string;
    session.user.role = (token.role as string) ?? "USER";
  }
  return session;
}
