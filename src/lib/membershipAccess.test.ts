import { describe, expect, it } from 'vitest';
import { effectiveMembershipAccess } from './membershipAccess';

describe('membership access preview', () => {
  const groups = [{id:'parent',environment_id:'env'}, {id:'child',environment_id:'env',parent_group_id:'parent'}];
  const state = { workspaceRole:'owner',workspaceWide:true,environments:[{environment_id:'env',role:'member'}],groups:[{group_id:'parent',role:'viewer'}] };
  it('shows the nearest direct grant even when inheritance is stronger', () => {
    expect(effectiveMembershipAccess(state,'env','child',groups)).toBe('viewer from ancestor group grant');
    expect(effectiveMembershipAccess({...state,groups:[...state.groups,{group_id:'child',role:'admin'}]},'env','child',groups)).toBe('admin from direct group grant');
  });
  it('shows the actual inherited access revealed by removal', () => {
    expect(effectiveMembershipAccess({...state,groups:[]},'env','child',groups)).toBe('member from direct environment grant');
    expect(effectiveMembershipAccess({...state,groups:[],environments:[]},'env','child',groups)).toBe('owner inherited from workspace');
    expect(effectiveMembershipAccess({...state,workspaceWide:false,groups:[],environments:[]},'env','child',groups)).toBe('No access');
  });
});
