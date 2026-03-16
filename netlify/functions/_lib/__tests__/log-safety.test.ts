import { describe, expect, it } from "vitest";
import { sanitizeErrorForLog } from "../log-safety.js";

describe("sanitizeErrorForLog", () => {
  it("redacts bearer tokens and OpenAI-style secret keys from Error payloads", () => {
    const err = new Error(
      "OpenAI request failed: Authorization: Bearer sk-testsecret1234567890",
    );
    const safe = sanitizeErrorForLog(err) as Record<string, unknown>;
    const message = String(safe.message || "");

    expect(message).not.toContain("sk-testsecret1234567890");
    expect(message).toContain("[REDACTED]");
  });

  it("redacts nested sensitive object fields by key name", () => {
    const safe = sanitizeErrorForLog({
      details: {
        api_key: "sk-live-abcdef1234567890",
        authorization: "Bearer abc.def.ghi",
        nested: { token: "xyz" },
      },
      keep: "ok",
    }) as Record<string, unknown>;

    expect((safe.details as Record<string, unknown>).api_key).toBe("[REDACTED]");
    expect((safe.details as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect(
      ((safe.details as Record<string, unknown>).nested as Record<string, unknown>)
        .token,
    ).toBe("[REDACTED]");
    expect(safe.keep).toBe("ok");
  });
});
