import { describe, expect, it } from "vitest";

import { sanitizeOperationalLogText } from "../operational-log.js";

describe("sanitizeOperationalLogText", () => {
  it("redacts large JSON base64 image fields without dropping surrounding evidence", () => {
    const base64 = "A".repeat(900);
    const sanitized = sanitizeOperationalLogText(
      `{"type":"image","content":{"type":"image/png","data":"${base64}","originalSize":1234}}\n{"type":"rate_limit_event"}`,
    );

    expect(sanitized).toContain('"type":"image/png"');
    expect(sanitized).toContain("[redacted-base64:900 chars]");
    expect(sanitized).not.toContain(base64);
    expect(sanitized).toContain('"type":"rate_limit_event"');
  });

  it("keeps ordinary provider limit text intact", () => {
    const text = "You've hit your session limit · resets 2:40am (UTC)";
    expect(sanitizeOperationalLogText(text)).toBe(text);
  });
});
