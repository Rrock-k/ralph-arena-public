function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatAdminShortTimestamp(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError(`Invalid admin timestamp: ${String(value)}`);
  }

  return [
    `${date.getUTCMonth() + 1}/${date.getUTCDate()},`,
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`,
  ].join(" ");
}
