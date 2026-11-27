import { createHash } from 'node:crypto';

export type FeedbackItemStatus =
  | 'open'
  | `reopened#${number}`
  | 'closed'
  | 'blocked'
  | 'needs_clarification'
  | 'unknown';

export interface ExtractFeedbackItemsOptions {
  specFile?: string;
  specHash?: string;
}

export interface SpecFeedbackItem {
  id: `BUG-${string}`;
  status: FeedbackItemStatus;
  title: string;
  summary?: string;
  expected?: string;
  actual?: string;
  sectionPath: string[];
  specFile?: string;
  specHash?: string;
  itemTextHash: string;
  itemText: string;
  lineStart: number;
  lineEnd: number;
}

interface Heading {
  level: number;
  title: string;
}

interface Candidate {
  lineIndex: number;
  id: SpecFeedbackItem['id'];
  tableCells?: string[];
}

interface Range {
  start: number;
  end: number;
}

const BUG_ID_PATTERN = /\bBUG-\d+\b/i;

export function extractCurrentFeedbackItems(
  markdown: string,
  options: ExtractFeedbackItemsOptions = {},
): SpecFeedbackItem[] {
  const lines = markdown.split(/\r?\n/);
  const pathsByLine = buildHeadingPaths(lines);
  const implementationGapRanges = findSectionRanges(lines, 'Implementation Gaps');
  const ranges = implementationGapRanges.length > 0
    ? implementationGapRanges
    : [{ start: 0, end: lines.length }];

  const candidates = ranges.flatMap((range) => findCandidates(lines, range));
  const items = candidates.map((candidate, index) => {
    const range = findCandidateRange(lines, candidate, candidates[index + 1]);
    return buildFeedbackItem(lines, pathsByLine, candidate, range, options);
  });

  return dedupeFeedbackItems(items);
}

export function getWorkRequiredFeedbackItems(items: SpecFeedbackItem[]): SpecFeedbackItem[] {
  return items.filter((item) => item.status !== 'closed');
}

function buildHeadingPaths(lines: string[]): string[][] {
  const stack: Heading[] = [];
  const paths: string[][] = [];

  for (const line of lines) {
    paths.push(stack.map((heading) => heading.title));
    const heading = parseHeading(line);
    if (!heading) continue;

    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
  }

  return paths;
}

function findSectionRanges(lines: string[], headingTitle: string): Range[] {
  const ranges: Range[] = [];

  for (let index = 0; index < lines.length; index++) {
    const heading = parseHeading(lines[index]);
    if (!heading || normalizeHeadingTitle(heading.title) !== normalizeHeadingTitle(headingTitle)) {
      continue;
    }

    let end = lines.length;
    for (let next = index + 1; next < lines.length; next++) {
      const nextHeading = parseHeading(lines[next]);
      if (nextHeading && nextHeading.level <= heading.level) {
        end = next;
        break;
      }
    }
    ranges.push({ start: index + 1, end });
  }

  return ranges;
}

function findCandidates(lines: string[], range: Range): Candidate[] {
  const candidates: Candidate[] = [];
  const seenLineIndexes = new Set<number>();

  for (let lineIndex = range.start; lineIndex < range.end; lineIndex++) {
    const line = lines[lineIndex];
    if (isTocBugLink(line)) continue;

    const tableCells = parseTableCells(line);
    const tableBugId = tableCells?.find((cell) => BUG_ID_PATTERN.test(cell))?.match(BUG_ID_PATTERN)?.[0];
    if (tableCells && tableBugId) {
      candidates.push({
        lineIndex,
        id: normalizeBugId(tableBugId),
        tableCells,
      });
      seenLineIndexes.add(lineIndex);
      continue;
    }

    const leadingBugId = matchLeadingBugId(line);
    if (!leadingBugId || seenLineIndexes.has(lineIndex)) continue;
    candidates.push({ lineIndex, id: normalizeBugId(leadingBugId) });
  }

  return candidates;
}

function findCandidateRange(lines: string[], candidate: Candidate, nextCandidate?: Candidate): Range {
  if (candidate.tableCells) {
    return { start: candidate.lineIndex, end: candidate.lineIndex + 1 };
  }

  let end = nextCandidate?.lineIndex ?? lines.length;
  for (let lineIndex = candidate.lineIndex + 1; lineIndex < end; lineIndex++) {
    if (parseHeading(lines[lineIndex])) {
      end = lineIndex;
      break;
    }
  }

  return { start: candidate.lineIndex, end };
}

function buildFeedbackItem(
  lines: string[],
  pathsByLine: string[][],
  candidate: Candidate,
  range: Range,
  options: ExtractFeedbackItemsOptions,
): SpecFeedbackItem {
  const rawText = candidate.tableCells
    ? candidate.tableCells.join(' | ')
    : lines.slice(range.start, range.end).join('\n');
  const itemText = normalizeItemText(rawText);
  const sectionPath = pathsByLine[candidate.lineIndex] ?? [];
  const fieldSource = candidate.tableCells ? candidate.tableCells.join('\n') : itemText;

  return {
    id: candidate.id,
    status: detectStatus(fieldSource, sectionPath),
    title: extractTitle(lines[candidate.lineIndex], candidate.id, candidate.tableCells),
    summary: extractField(fieldSource, ['Summary', 'Latest note', 'Note']),
    expected: extractField(fieldSource, ['Expected']),
    actual: extractField(fieldSource, ['Actual']),
    sectionPath,
    specFile: options.specFile,
    specHash: options.specHash,
    itemTextHash: hashItemText(itemText),
    itemText,
    lineStart: range.start + 1,
    lineEnd: range.end,
  };
}

function dedupeFeedbackItems(items: SpecFeedbackItem[]): SpecFeedbackItem[] {
  const byId = new Map<string, SpecFeedbackItem>();

  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || itemScore(item) > itemScore(existing)) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    if (a.lineStart !== b.lineStart) return a.lineStart - b.lineStart;
    return a.id.localeCompare(b.id);
  });
}

function itemScore(item: SpecFeedbackItem): number {
  let score = 0;
  if (item.title) score += 1;
  if (item.summary) score += 2;
  if (item.expected) score += 3;
  if (item.actual) score += 3;
  if (item.status !== 'unknown') score += 2;
  if (item.status !== 'closed') score += 1;
  score += Math.min(5, Math.floor(item.itemText.length / 80));
  return score;
}

function parseHeading(line: string): Heading | null {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return {
    level: match[1].length,
    title: stripMarkdown(match[2]).trim(),
  };
}

function matchLeadingBugId(line: string): string | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)?(?:`)?(BUG-\d+)\b/i);
  return match?.[1] ?? null;
}

function isTocBugLink(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+\[[^\]]*\bBUG-\d+\b[^\]]*\]\(#[^)]+\)\s*$/i.test(line);
}

function parseTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)) return null;
  return trimmed.slice(1, -1).split('|').map((cell) => stripMarkdown(cell).trim());
}

function detectStatus(text: string, sectionPath: string[]): FeedbackItemStatus {
  const reopened = text.match(/\breopened\s*#\s*(\d+)\b/i);
  if (reopened) return `reopened#${Number(reopened[1])}`;

  const explicit = extractStatusField(text);
  if (explicit) return explicit;

  for (const pathPart of [...sectionPath].reverse()) {
    const normalized = normalizeHeadingTitle(pathPart).replace(/\s+/g, '_');
    if (normalized === 'needs_clarification') return 'needs_clarification';
    if (normalized === 'blocked') return 'blocked';
    if (normalized === 'done' || normalized === 'closed') return 'closed';
    if (normalized === 'open' || normalized === 'opened') return 'open';
  }

  return 'unknown';
}

function extractStatusField(text: string): FeedbackItemStatus | null {
  const statusLine = text.match(
    /(?:^|\n)\s*(?:[-*+]\s*)?(?:\*\*)?Status(?:\*\*)?\s*:\s*([^\n]+)/i,
  )?.[1];
  const firstLine = text.split('\n')[0] ?? '';
  const decoratedStatus = firstLine.match(
    /[\[(]\s*(open|opened|done|closed|fixed|resolved|blocked|needs[_ -]?clarification|reopened\s*#?\s*\d+)\s*[\])]/i,
  )?.[1];
  const statusText = statusLine ?? decoratedStatus;
  if (!statusText) return null;

  const reopened = statusText.match(/\breopened\s*#?\s*(\d+)\b/i);
  if (reopened) return `reopened#${Number(reopened[1])}`;
  if (/^needs[_ -]?clarification\b/i.test(statusText)) return 'needs_clarification';
  if (/^blocked\b/i.test(statusText)) return 'blocked';
  if (/^(?:done|closed|fixed|resolved)\b/i.test(statusText)) return 'closed';
  if (/^(?:open|opened)\b/i.test(statusText)) return 'open';
  return null;
}

function extractTitle(line: string, id: string, tableCells?: string[]): string {
  if (tableCells) {
    const idCellIndex = tableCells.findIndex((cell) => cell.toUpperCase() === id);
    const titleCell = tableCells.find((cell, index) => {
      if (index === idCellIndex) return false;
      return !isStatusText(cell) && !/^(expected|actual|summary|latest note|note)\s*:/i.test(cell);
    });
    return titleCell ? cleanTitle(titleCell, id) : id;
  }

  return cleanTitle(line, id) || id;
}

function cleanTitle(line: string, id: string): string {
  return stripMarkdown(line)
    .replace(/^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '')
    .replace(new RegExp(`\\b${escapeRegExp(id)}\\b`, 'i'), '')
    .replace(/\bstatus\s*:\s*(?:open|opened|done|closed|fixed|resolved|blocked|needs[_ -]?clarification|reopened\s*#?\s*\d+)\b/ig, '')
    .replace(/\((?:open|opened|done|closed|fixed|resolved|blocked|needs[_ -]?clarification|reopened\s*#?\s*\d+)\)/ig, '')
    .replace(/\[(?:open|opened|done|closed|fixed|resolved|blocked|needs[_ -]?clarification|reopened\s*#?\s*\d+)\]/ig, '')
    .replace(/^\s*[:\-–—]\s*/, '')
    .trim();
}

function extractField(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const pattern = new RegExp(
      `(?:^|\\n)\\s*(?:[-*+]\\s*)?(?:\\*\\*)?${escapeRegExp(label)}(?:\\*\\*)?\\s*:\\s*(.+)`,
      'i',
    );
    const match = text.match(pattern);
    if (match) return stripMarkdown(match[1]).trim();
  }
  return undefined;
}

function isStatusText(text: string): boolean {
  return /^(?:status\s*:\s*)?(?:open|opened|done|closed|fixed|resolved|blocked|needs[_ -]?clarification|reopened\s*#?\s*\d+)$/i.test(text.trim());
}

function normalizeBugId(id: string): SpecFeedbackItem['id'] {
  return id.toUpperCase() as SpecFeedbackItem['id'];
}

function normalizeHeadingTitle(title: string): string {
  return title.trim().toLowerCase();
}

function normalizeItemText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hashItemText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
