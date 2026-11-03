export interface AccessGrantState {
  workspaceRole: string;
  workspaceWide: boolean;
  environments: Array<{ environment_id: string; role: string }>;
  groups: Array<{ group_id: string; role: string }>;
}
export interface AccessGroup {
  id: string;
  environment_id: string;
  parent_group_id?: string | null;
  parent_id?: string | null;
}

// Keep the server's nearest-direct-grant precedence. A lower direct role can
// deliberately constrain inherited access; this is not a highest-role union.
export function effectiveMembershipAccess(state: AccessGrantState, environmentId: string, groupId?: string, groups: AccessGroup[] = []) {
  let current = groupId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const direct = state.groups.find(g => g.group_id === current);
    if (direct) return `${direct.role} from ${current === groupId ? 'direct group grant' : 'ancestor group grant'}`;
    const group = groups.find(g => g.id === current && g.environment_id === environmentId);
    current = group?.parent_group_id ?? group?.parent_id ?? undefined;
  }
  const environment = state.environments.find(e => e.environment_id === environmentId);
  if (environment) return `${environment.role} from direct environment grant`;
  return state.workspaceWide ? `${state.workspaceRole} inherited from workspace` : 'No access';
}
