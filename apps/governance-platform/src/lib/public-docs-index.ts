import { readdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

export interface PublicHtmlDoc {
  addedAtIso: string;
  addedAtMs: number;
  href: string;
  label: string;
  relativePath: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function publicRoot(): string {
  return path.join(process.cwd(), "public");
}

function toHref(relativePath: string): string {
  return `/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function toLabel(relativePath: string): string {
  const basename = path.basename(relativePath, ".html");
  return basename.replaceAll("_", " ").replaceAll("-", " ");
}

function addedAtFromStats(info: Stats): number {
  return info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs;
}

async function collectHtmlDocs(dirPath: string, relativeDir: string, docs: PublicHtmlDoc[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;

    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await collectHtmlDocs(absolutePath, relativePath, docs);
      continue;
    }

    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".html") continue;
    if (relativePath === "docs.html") continue;

    const info = await stat(absolutePath);
    const addedAtMs = addedAtFromStats(info);
    docs.push({
      addedAtIso: new Date(addedAtMs).toISOString(),
      addedAtMs,
      href: toHref(relativePath),
      label: toLabel(relativePath),
      relativePath: relativePath.split(path.sep).join("/"),
    });
  }
}

export async function listPublicHtmlDocs(): Promise<PublicHtmlDoc[]> {
  const docs: PublicHtmlDoc[] = [];
  await collectHtmlDocs(publicRoot(), "", docs);
  return docs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function renderPublicDocsIndex(docs: PublicHtmlDoc[]): string {
  const rows = docs.length
    ? docs.map((doc) => `
        <li data-label="${escapeHtml(doc.label.toLowerCase())}" data-path="${escapeHtml(doc.relativePath.toLowerCase())}" data-added="${doc.addedAtMs}">
          <a href="${escapeHtml(doc.href)}">${escapeHtml(doc.label)}</a>
          <div class="meta">
            <span class="path">${escapeHtml(doc.relativePath)}</span>
            <time datetime="${escapeHtml(doc.addedAtIso)}">${escapeHtml(doc.addedAtIso.slice(0, 10))}</time>
          </div>
        </li>`).join("")
    : `
        <li>
          <span>No HTML docs found.</span>
        </li>`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Public docs</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: Canvas;
      color: CanvasText;
    }

    body {
      margin: 0;
      padding: 32px;
    }

    main {
      max-width: 920px;
      margin: 0 auto;
    }

    header {
      margin-bottom: 28px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 30px;
      line-height: 1.15;
      letter-spacing: 0;
    }

    p {
      margin: 0;
      color: color-mix(in srgb, CanvasText 68%, transparent);
      line-height: 1.55;
    }

    .toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 12px;
      margin: 0 0 18px;
    }

    input,
    select {
      box-sizing: border-box;
      width: 100%;
      min-height: 42px;
      border: 1px solid color-mix(in srgb, CanvasText 24%, transparent);
      border-radius: 6px;
      background: Canvas;
      color: CanvasText;
      font: inherit;
      letter-spacing: 0;
    }

    input {
      padding: 0 12px;
    }

    select {
      padding: 0 10px;
    }

    .summary {
      margin: 0 0 10px;
      font-size: 13px;
      color: color-mix(in srgb, CanvasText 58%, transparent);
    }

    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
    }

    li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 14px 0;
      border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
    }

    a {
      color: LinkText;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
      overflow-wrap: anywhere;
    }

    .path {
      color: color-mix(in srgb, CanvasText 54%, transparent);
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .meta {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      min-width: 0;
      color: color-mix(in srgb, CanvasText 54%, transparent);
      font-size: 13px;
    }

    time {
      white-space: nowrap;
    }

    @media (max-width: 640px) {
      body {
        padding: 24px 18px;
      }

      .toolbar {
        grid-template-columns: 1fr;
      }

      li {
        grid-template-columns: 1fr;
        gap: 6px;
      }

      .meta {
        align-items: flex-start;
        flex-direction: column;
        gap: 4px;
      }

      .path {
        white-space: normal;
      }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Public docs</h1>
      <p>HTML documents currently available from the governance public folder.</p>
    </header>

    <div class="toolbar">
      <input id="search" type="search" placeholder="Поиск документов" autocomplete="off">
      <select id="sort">
        <option value="date-desc">Дата добавления: новые</option>
        <option value="date-asc">Дата добавления: старые</option>
        <option value="alpha-asc">Алфавит: А-Я</option>
        <option value="alpha-desc">Алфавит: Я-А</option>
      </select>
    </div>
    <p class="summary" id="summary">${docs.length} docs</p>

    <ul id="docs-list">${rows}
    </ul>
  </main>
  <script>
    const search = document.getElementById('search');
    const sort = document.getElementById('sort');
    const list = document.getElementById('docs-list');
    const summary = document.getElementById('summary');
    const items = Array.from(list.querySelectorAll('li[data-label]'));

    function compareItems(left, right) {
      const mode = sort.value;
      if (mode === 'date-desc') return Number(right.dataset.added) - Number(left.dataset.added);
      if (mode === 'date-asc') return Number(left.dataset.added) - Number(right.dataset.added);

      const byLabel = left.dataset.label.localeCompare(right.dataset.label, undefined, { sensitivity: 'base' });
      return mode === 'alpha-desc' ? -byLabel : byLabel;
    }

    function renderList() {
      const query = search.value.trim().toLowerCase();
      const visible = items
        .filter((item) => !query || item.dataset.label.includes(query) || item.dataset.path.includes(query))
        .sort(compareItems);

      list.replaceChildren(...visible);
      summary.textContent = visible.length === items.length
        ? \`\${items.length} docs\`
        : \`\${visible.length} / \${items.length} docs\`;
    }

    for (const item of items) {
      const time = item.querySelector('time');
      if (!time) continue;
      const date = new Date(Number(item.dataset.added));
      time.textContent = new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    }

    search.addEventListener('input', renderList);
    sort.addEventListener('change', renderList);
    renderList();
  </script>
</body>
</html>`;
}

export async function publicDocsIndexResponse(): Promise<Response> {
  const docs = await listPublicHtmlDocs();
  return new Response(renderPublicDocsIndex(docs), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
