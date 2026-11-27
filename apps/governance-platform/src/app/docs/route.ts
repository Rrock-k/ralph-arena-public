import { publicDocsIndexResponse } from "@/lib/public-docs-index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return publicDocsIndexResponse();
}
