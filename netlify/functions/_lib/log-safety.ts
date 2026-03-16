const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|authorization|api[_-]?key|private[_-]?key|totp|otp|activationcode)/i;

function redactSensitiveText(text: string): string {
  return text
    .replace(
      /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
      `Bearer ${REDACTED}`,
    )
    .replace(/\bsk-[A-Za-z0-9]{10,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(
      /\b(api[_-]?key|authorization|token|secret|password)\s*[:=]\s*["']?[^"',\s]+["']?/gi,
      (_m, key: string) => `${key}=${REDACTED}`,
    );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: redactSensitiveText(value.name),
      message: redactSensitiveText(value.message),
      stack: typeof value.stack === "string" ? redactSensitiveText(value.stack) : undefined,
      cause: sanitizeValue((value as { cause?: unknown }).cause, depth + 1),
    };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = sanitizeValue(entry, depth + 1);
      }
    }
    return out;
  }
  return redactSensitiveText(String(value));
}

export function sanitizeErrorForLog(err: unknown): unknown {
  return sanitizeValue(err, 0);
}
