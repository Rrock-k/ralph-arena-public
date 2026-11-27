import { NextResponse } from "next/server";

export function projectAccessStatus(error: string | undefined): number {
  switch (error) {
    case "Unauthorized":
      return 401;
    case "Project not found":
      return 404;
    default:
      return 403;
  }
}

export function projectAccessJsonResponse(error: string | undefined): NextResponse {
  const message = error ?? "Project access denied";
  return NextResponse.json({ error: message }, { status: projectAccessStatus(message) });
}

export function projectAccessTextResponse(error: string | undefined): Response {
  const message = error ?? "Project access denied";
  return new Response(message, { status: projectAccessStatus(message) });
}
