import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { shouldBlockPublicControlPlaneRequest } from "@/lib/control-plane-access";

export function proxy(request: NextRequest) {
  // Cloudflare tunnel sends requests over HTTP internally.
  // NextAuth needs X-Forwarded-Proto to build correct callback URLs.
  const requestHeaders = new Headers(request.headers);
  if (
    requestHeaders.get("cf-visitor") ||
    requestHeaders.get("cf-ray")
  ) {
    requestHeaders.set("x-forwarded-proto", "https");
  }

  const requestHost = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  if (shouldBlockPublicControlPlaneRequest({
    pathname: request.nextUrl.pathname,
    requestHost,
  })) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/api/auth/:path*", "/api/admin/ctl/:path*"],
};
