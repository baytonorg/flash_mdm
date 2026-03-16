/**
 * Build an AMAPI-compatible update mask containing only the top-level keys
 * that actually differ between the previous and next policy configs.
 *
 * Keys present in previousConfig but absent from nextConfig are included
 * so that AMAPI clears the field (intentional removal).
 *
 * Keys present in both configs with identical serialized values are
 * excluded — there is nothing to update.
 */
export function buildPolicyUpdateMask(
  previousConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>
): string | null {
  const prev = previousConfig ?? {};
  const next = nextConfig ?? {};
  const allKeys = new Set<string>([
    ...Object.keys(prev),
    ...Object.keys(next),
  ]);

  const changed: string[] = [];
  for (const key of allKeys) {
    const hadKey = key in prev;
    const hasKey = key in next;

    // Key added or removed → changed
    if (hadKey !== hasKey) {
      changed.push(key);
      continue;
    }

    // Both present — compare serialized values
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }

  if (changed.length === 0) return null;
  return changed.sort().join(',');
}

