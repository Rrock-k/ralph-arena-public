export interface TaskDisplayInput {
  id: string;
  displayTitle?: string | null;
  description?: string | null;
}

export function cleanDisplayText(value: unknown, maxLength = 80): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength - 3).trim();
  const lastSpace = clipped.lastIndexOf(' ');
  const readable = lastSpace >= Math.floor((maxLength - 3) * 0.6)
    ? clipped.slice(0, lastSpace)
    : clipped;
  return `${readable}...`;
}

export function getTaskDisplayTitle(task: TaskDisplayInput, maxLength = 80): string {
  const explicit = cleanDisplayText(task.displayTitle, maxLength);
  if (explicit) return explicit;

  const firstLine = typeof task.description === 'string'
    ? task.description.split(/\r?\n/)[0]
    : null;
  const firstSentence = firstLine
    ? firstLine.split(/(?<=[.!?])\s+/)[0]
    : null;
  return cleanDisplayText(firstSentence, maxLength) ?? task.id;
}

export function formatTaskLogLabel(task: TaskDisplayInput, maxLength = 80): string {
  const title = getTaskDisplayTitle(task, maxLength);
  return title === task.id ? task.id : `${task.id} - ${title}`;
}
