/**
 * Soft billing hook for Flashi assistant.
 *
 * Default: permissive (returns true).
 * When `assistant_paid_enforcement_enabled` is set on the platform,
 * this will check workspace licensing/billing metadata to gate Flashi
 * as a paid addon. For now, always returns true.
 */
export async function checkAssistantEntitlement(
  _workspaceId: string,
  _environmentId: string,
): Promise<{ entitled: boolean; reason?: string }> {
  // Future: check workspace licensing metadata for assistant addon
  // const enforcementEnabled = process.env.ASSISTANT_PAID_ENFORCEMENT_ENABLED === 'true';
  // if (!enforcementEnabled) return { entitled: true };
  // ... check billing metadata ...

  return { entitled: true };
}
