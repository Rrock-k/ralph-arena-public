export function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function errorResult(message: string, details?: unknown) {
  const suffix = details === undefined
    ? ""
    : `\n\n${typeof details === "string" ? details : JSON.stringify(details, null, 2)}`;

  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `${message}${suffix}`,
      },
    ],
  };
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
