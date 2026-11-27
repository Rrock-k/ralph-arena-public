import Link from "next/link";
import { notFound } from "next/navigation";
import { PreviewIframe } from "@/components/preview/PreviewIframe";
import { isValidPreviewUrl } from "@/lib/preview-url";

interface PreviewPageProps {
  searchParams: Promise<{
    url?: string;
    title?: string;
  }>;
}

export default async function PreviewPage({ searchParams }: PreviewPageProps) {
  const { url: previewUrl, title } = await searchParams;
  const proposalTitle = title || "Preview";

  if (!previewUrl || !isValidPreviewUrl(previewUrl)) {
    notFound();
  }

  return (
    <>
      {/* Floating toolbar */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/10 bg-[#0a0d14]">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08]"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back
        </Link>

        <h1 className="truncate text-sm font-semibold text-slate-100">
          {proposalTitle}
        </h1>

        <div />
        {/* spacer — raw link removed */}
      </div>

      {/* Full-screen iframe */}
      <div className="flex-1 overflow-hidden">
        <PreviewIframe
          previewUrl={previewUrl}
          proposalTitle={proposalTitle}
          iframeClassName="h-full w-full border-0 bg-white"
          fallbackClassName="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center text-slate-300"
        />
      </div>
    </>
  );
}
