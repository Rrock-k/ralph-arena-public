import { NextResponse } from "next/server";
import { readRecentCommits } from "@/lib/a2e-ops";

const PAGE_SIZE = 40;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const skip = Math.max(0, Number(searchParams.get("skip")) || 0);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || PAGE_SIZE));

  const commits = readRecentCommits(limit, skip);
  return NextResponse.json({ commits, hasMore: commits.length === limit });
}
