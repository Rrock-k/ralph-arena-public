import { NextRequest, NextResponse } from "next/server";
import { readFile, access } from "fs/promises";
import path from "path";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    const filePath = path.join(process.cwd(), "deployments", ...pathSegments);

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    const deploymentsDir = path.join(process.cwd(), "deployments");

    if (!normalizedPath.startsWith(deploymentsDir)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    await access(normalizedPath);
    const fileContent = await readFile(normalizedPath);
    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || "text/html";

    return new NextResponse(fileContent, {
      headers: { "Content-Type": contentType },
    });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    console.error("Error serving deployment file:", error);
    return NextResponse.json(
      { error: "Failed to serve file" },
      { status: 500 }
    );
  }
}
