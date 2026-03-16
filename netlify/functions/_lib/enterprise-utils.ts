/**
 * Shared enterprise resource name utilities.
 */

/**
 * Extract the enterprise prefix (e.g. "enterprises/LC01abc123") from a
 * resource name string. Returns null if the value is not a valid enterprise-scoped name.
 */
export function extractEnterprisePrefix(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^enterprises\/[^/]+/i.exec(value.trim());
  return match ? match[0] : null;
}
