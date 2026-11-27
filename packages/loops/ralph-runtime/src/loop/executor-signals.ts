export function detectExecutorNeedsReplanSignal(output: string): boolean {
  const tailStart = output.length < 200 ? 0 : Math.floor(output.length * 0.6);
  const tail = output.slice(tailStart);
  return /<signal>\s*NEEDS_REPLAN\s*<\/signal>/i.test(tail);
}

export function detectExecutorCompletionPromise(output: string, promise: string): boolean {
  const escaped = promise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nearEndThreshold = Math.max(output.length - 12_000, Math.floor(output.length * 0.6));

  const tagRe = new RegExp(`<promise>\\s*${escaped}\\s*</promise>`, 'gi');
  const tagMatches = Array.from(output.matchAll(tagRe));

  for (const match of tagMatches) {
    const idx = match.index ?? -1;
    if (idx < 0) continue;
    const lineStart = output.lastIndexOf('\n', idx) + 1;
    const lineEnd = (output.indexOf('\n', idx) + 1 || output.length + 1) - 1;
    const line = output.slice(lineStart, lineEnd).trim();
    if (/when\s+done|completion\s+signal|output\s*:\s*<promise>/i.test(line)) continue;
    if (idx >= nearEndThreshold) return true;
  }

  const rawRe = new RegExp(`^[\\s*<>#]*${escaped}[\\s*>]*$`, 'gim');
  const rawMatches = Array.from(output.matchAll(rawRe));

  for (const match of rawMatches) {
    const idx = match.index ?? -1;
    if (idx < 0) continue;
    const before = output.slice(Math.max(0, idx - 200), idx);
    if (/when\s+done|completion\s+signal|criteria\s+met/i.test(before)) continue;
    if (idx >= nearEndThreshold) return true;
  }

  return false;
}

export function detectMalformedExecutorCompletion(output: string, promise: string): string | null {
  if (detectExecutorCompletionPromise(output, promise)) return null;

  const tail = output.slice(Math.floor(output.length * 0.7));
  const escaped = promise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rawPattern = new RegExp(escaped, 'gi');

  if (!rawPattern.test(tail)) return null;

  const properPattern = new RegExp(`<promise>\\s*${escaped}\\s*</promise>`, 'gi');
  if (properPattern.test(tail)) return null;

  return [
    `COMPLETION FORMAT ERROR: Agent wrote "${promise}" but not in the required format.`,
    `The system did not register the task as complete.`,
    `The expected format is: <promise>${promise}</promise>`,
  ].join(' ');
}
