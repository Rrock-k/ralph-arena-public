"use client";

import { useEffect, useState, useCallback } from "react";

interface ComponentInfo {
  name: string;
  props: Record<string, unknown>;
  source: { fileName: string; lineNumber: number } | null;
}

interface SelectedInfo {
  rect: DOMRect;
  /** React component chain (our code only), innermost first */
  chain: ComponentInfo[];
  /** Concise description of the clicked DOM element */
  elementDesc: string;
}

// ── Fiber helpers ──────────────────────────────────────────

function getFiber(el: HTMLElement): any {
  const key = Object.keys(el).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  return key ? (el as any)[key] : null;
}

/** Known library prefixes / patterns to skip */
const SKIP_PATTERNS = [
  /^Provider$/, /^Consumer$/, /^Context$/, /^Fragment$/,
  /^Suspense$/, /^Lazy$/, /^StrictMode$/, /^Profiler$/,
  /^ForwardRef$/, /^Memo$/,
  // Radix / headless UI / popover libs
  /^(Popper|Portal|Presence|Slot|Collection|Dismissable|Focus)/,
  /Provider$/, /Consumer$/,
  // Next.js internals
  /^(InnerLayout|OuterLayout|RenderFrom|HotReload|Router|Head)/,
  /^(NotFound|Loading|RedirectBoundary|RootLayout)/,
  /^(ScrollAndFocusHandler|InnerScrollAndFocusHandler|ErrorBoundary|RedirectErrorBoundary)/,
  /^(LayoutRouter|AppRouter|ServerRoot|PathnameContext|SearchParamsContext)/,
  /^(ReactDevOverlay|DevOverlay)/,
  /^(AdminThemeShell|ThemeProvider|SessionProvider|LiveRefresh)$/,
  /^(ContextMenu|Menu|Dialog|Popover|Tooltip|DropdownMenu|Select|Accordion|Tabs|Toast)$/,
  /^(MenuSub|DialogContent|PopoverContent|TooltipContent|SelectContent)$/,
  /Boundary$/,
  // Generic wrappers
  /^(Root|Trigger|Content|Overlay|Arrow|Viewport|Item|Group|Label|Separator)$/,
];

function isOurComponent(name: string, source: any): boolean {
  // If has _debugSource pointing to our src/ — definitely ours
  if (source?.fileName?.includes("/src/")) return true;
  // Skip known library patterns
  if (SKIP_PATTERNS.some((p) => p.test(name))) return false;
  // Short generic names are likely library
  if (name.length <= 2) return false;
  // PascalCase and not in skip list — probably ours
  return true;
}

/** Describe the clicked DOM element concisely */
function describeElement(el: HTMLElement): string {
  let desc = describeOne(el);
  // For elements with no useful info (svg, path, img), add parent context
  const tag = el.tagName.toLowerCase();
  if (!getOwnText(el) && (tag === "svg" || tag === "path" || tag === "img" || tag === "canvas" || tag === "hr")) {
    const parent = el.parentElement;
    if (parent) {
      const parentDesc = describeOne(parent);
      const parentText = getOwnText(parent);
      if (parentText) desc = `${parentDesc} "${parentText}" > ${desc}`;
      else desc = `${parentDesc} > ${desc}`;
    }
  }
  return desc;
}

function describeOne(el: HTMLElement): string {
  let desc = el.tagName.toLowerCase();
  if (el.id) desc += `#${el.id}`;
  else if (typeof el.className === "string") {
    const cls = el.className.trim().split(/\s+/).filter((c) => !c.includes("[") && c.length < 25);
    if (cls.length) desc += `.${cls[0]}`;
  }
  // aria-label is often meaningful on icons
  const label = el.getAttribute("aria-label") || el.getAttribute("title");
  if (label) { desc += ` "${label}"`; return desc; }
  const ownText = getOwnText(el);
  if (ownText) desc += ` "${ownText}"`;
  return desc;
}

/** Get direct text of element (not deeply nested children), truncated */
function getOwnText(el: HTMLElement): string | null {
  // For leaf nodes, use textContent directly
  if (el.children.length === 0) {
    const t = el.textContent?.trim();
    return t && t.length <= 40 ? t : t ? t.slice(0, 37) + "..." : null;
  }
  // For containers, collect only direct text nodes
  let text = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent?.trim() ?? "";
  }
  return text && text.length <= 40 ? text : text ? text.slice(0, 37) + "..." : null;
}

function collectComponentChain(el: HTMLElement): { chain: ComponentInfo[]; elementDesc: string } {
  const elementDesc = describeElement(el);
  let fiber = getFiber(el);
  const chain: ComponentInfo[] = [];
  let visited = 0;

  while (fiber && visited < 80) {
    visited++;
    if (typeof fiber.type === "function") {
      const name = fiber.type.displayName || fiber.type.name;
      const source = fiber._debugSource || null;

      if (name && isOurComponent(name, source)) {
        const rawProps = fiber.memoizedProps || {};
        const props: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawProps)) {
          if (k === "children" || k === "className" || k === "style" || k === "ref") continue;
          if (typeof v === "function") continue;
          if (typeof v === "object" && v !== null) continue;
          props[k] = v;
        }
        chain.push({ name, props, source });
        if (chain.length >= 6) break;
      }
    }
    fiber = fiber.return;
  }

  return { chain, elementDesc };
}

// ── Format for copy ────────────────────────────────────────

function formatForCopy(info: SelectedInfo): string {
  const lines: string[] = [];

  if (info.chain.length === 0) {
    lines.push(info.elementDesc);
    return lines.join("\n");
  }

  // Breadcrumb: outermost > ... > innermost > [clicked element]
  const names = info.chain.map((c) => c.name).reverse();
  names.push(`[${info.elementDesc}]`);
  lines.push(names.join(" > "));

  // Source file of innermost component
  const leaf = info.chain[0];
  if (leaf.source?.fileName) {
    const short = shortenPath(leaf.source.fileName);
    lines.push(`  file: ${short}:${leaf.source.lineNumber}`);
  }

  return lines.join("\n");
}

function shortenPath(fileName: string): string {
  const idx = fileName.indexOf("/src/");
  if (idx !== -1) return fileName.slice(idx + 1);
  const parts = fileName.split("/");
  return parts.slice(-3).join("/");
}

// ── Clipboard ──────────────────────────────────────────────

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
}

// ── Component ──────────────────────────────────────────────

export function Inspector() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<SelectedInfo | null>(null);
  const [hovered, setHovered] = useState<DOMRect | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.shiftKey && (e.code === "KeyI")) {
        e.preventDefault();
        setActive((a) => !a);
        setSelected(null);
        setHovered(null);
      }
      if (e.key === "Escape" && active) {
        setActive(false);
        setSelected(null);
        setHovered(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  useEffect(() => {
    if (!active) return;

    function onMouseMove(e: MouseEvent) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!el || el.closest("[data-inspector]")) {
        setHovered(null);
        return;
      }
      setHovered(el.getBoundingClientRect());
    }

    function onClick(e: MouseEvent) {
      const el = e.target as HTMLElement;
      if (el.closest("[data-inspector]")) return;
      e.preventDefault();
      e.stopPropagation();

      const { chain, elementDesc } = collectComponentChain(el);
      setSelected({
        rect: el.getBoundingClientRect(),
        chain,
        elementDesc,
      });
      setHovered(null);
      setCopied(false);
    }

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);

  const handleCopy = useCallback(() => {
    if (!selected) return;
    copyToClipboard(formatForCopy(selected));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [selected]);

  if (!active) return null;

  const leaf = selected?.chain[0] ?? null;
  const breadcrumb = selected
    ? selected.chain.length > 0
      ? [...selected.chain.map((c) => c.name).reverse(), `[${selected.elementDesc}]`].join(" > ")
      : selected.elementDesc
    : "";

  return (
    <>
      {/* Banner */}
      <div
        data-inspector
        style={{
          position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
          zIndex: 99999, background: "#7c3aed", color: "#fff",
          padding: "4px 16px", borderRadius: "0 0 8px 8px",
          fontSize: 12, fontFamily: "monospace", pointerEvents: "none", opacity: 0.9,
        }}
      >
        INSPECTOR — click to select (Esc to close)
      </div>

      {/* Hover */}
      {hovered && !selected && (
        <div data-inspector style={{
          position: "fixed",
          top: hovered.top - 2, left: hovered.left - 2,
          width: hovered.width + 4, height: hovered.height + 4,
          border: "2px solid #7c3aed", borderRadius: 4,
          pointerEvents: "none", zIndex: 99998,
        }} />
      )}

      {/* Selection */}
      {selected && (
        <div data-inspector style={{
          position: "fixed",
          top: selected.rect.top - 2, left: selected.rect.left - 2,
          width: selected.rect.width + 4, height: selected.rect.height + 4,
          border: "2px solid #f59e0b", borderRadius: 4,
          pointerEvents: "none", zIndex: 99998,
          background: "rgba(245,158,11,0.08)",
        }} />
      )}

      {/* Popover */}
      {selected && (
        <div
          data-inspector
          style={{
            position: "fixed",
            top: Math.min(selected.rect.bottom + 8, window.innerHeight - 180),
            left: Math.min(Math.max(8, selected.rect.left), window.innerWidth - 500),
            zIndex: 99999, background: "#1e1b2e",
            border: "1px solid #7c3aed55", borderRadius: 8,
            padding: "10px 12px", maxWidth: 520, fontFamily: "monospace",
            fontSize: 12, color: "#e2e8f0", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          {/* Breadcrumb */}
          <div style={{ color: "#a78bfa", marginBottom: 4, lineHeight: 1.5, fontWeight: 600 }}>
            {breadcrumb}
          </div>

          {/* Source file */}
          {leaf?.source?.fileName && (
            <div style={{ color: "#94a3b8", marginBottom: 8, fontSize: 10 }}>
              {shortenPath(leaf.source.fileName)}:{leaf.source.lineNumber}
            </div>
          )}

          <button
            onClick={handleCopy}
            data-inspector
            style={{
              background: copied ? "#059669" : "#7c3aed", color: "#fff",
              border: "none", borderRadius: 4, padding: "5px 12px",
              cursor: "pointer", fontSize: 11, fontFamily: "monospace", width: "100%",
            }}
          >
            {copied ? "Copied!" : "Copy for AI"}
          </button>
        </div>
      )}
    </>
  );
}
