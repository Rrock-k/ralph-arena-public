const LONG_JSON_BASE64_FIELD_RE = /("(?:data|contentBase64)"\s*:\s*")([A-Za-z0-9+/=]{512,})(")/g;
const DATA_URI_IMAGE_RE = /data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]{512,}/gi;
const HEAVY_IMAGE_HINT_RE = /image\/(?:png|jpeg|jpg|webp)|"originalSize"\s*:|"dimensions"\s*:/i;
const MAX_IMAGE_LOG_LINE_CHARS = 8_000;
const IMAGE_LOG_LINE_HEAD_CHARS = 2_000;
const IMAGE_LOG_LINE_TAIL_CHARS = 1_000;

function redactLength(label: string, value: string): string {
  return `[redacted-${label}:${value.length} chars]`;
}

function sanitizeOperationalLogLine(line: string): string {
  let sanitized = line
    .replace(LONG_JSON_BASE64_FIELD_RE, (_match, prefix: string, value: string, suffix: string) => (
      `${prefix}${redactLength("base64", value)}${suffix}`
    ))
    .replace(DATA_URI_IMAGE_RE, (value) => `data:image/[redacted];base64,${redactLength("base64", value)}`);

  if (sanitized.length > MAX_IMAGE_LOG_LINE_CHARS && HEAVY_IMAGE_HINT_RE.test(sanitized)) {
    sanitized = [
      sanitized.slice(0, IMAGE_LOG_LINE_HEAD_CHARS),
      `...[redacted-heavy-image-log:${sanitized.length} chars]...`,
      sanitized.slice(-IMAGE_LOG_LINE_TAIL_CHARS),
    ].join("");
  }

  return sanitized;
}

export function sanitizeOperationalLogText(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((part) => part === "\n" || part === "\r\n" ? part : sanitizeOperationalLogLine(part))
    .join("");
}
