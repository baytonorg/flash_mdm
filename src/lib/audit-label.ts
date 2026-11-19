// Custom workflow records use a reserved action namespace. Never present their
// operator-authored requested_action as a native security/lifecycle event.
export function auditActionLabel(action: string): string {
  return action === 'workflow.custom_audit' ? 'Custom workflow audit' : action;
}
