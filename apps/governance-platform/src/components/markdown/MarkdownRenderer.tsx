"use client";

import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { useMemo } from "react";

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const html = useMemo(() => {
    const raw = marked.parse(content, {
      breaks: true,
      gfm: true,
      async: false,
    });
    return DOMPurify.sanitize(raw as string);
  }, [content]);

  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
