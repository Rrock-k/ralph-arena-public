import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const DEFAULT_READY_FILE = path.join(process.cwd(), ".playwright-server-ready");

export function GET() {
  if (process.env.PLAYWRIGHT_TEST !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const readyFile = process.env.PLAYWRIGHT_READY_FILE || DEFAULT_READY_FILE;
  if (!existsSync(readyFile)) {
    return NextResponse.json({ ready: false }, { status: 503 });
  }

  return NextResponse.json({ ready: true });
}
