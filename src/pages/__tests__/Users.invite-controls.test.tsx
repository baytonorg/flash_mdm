import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Users from '../Users';
import type { UserManagementControls } from '@/api/queries/users';

const fixture = vi.hoisted(() => ({
  controls: null as UserManagementControls | null,
  activeGroup: null as { id: string; name: string; environment_id: string } | null,
  failed: false,
  invite: vi.fn(),
}));
vi.mock('@tanstack/react-query', async original => ({ ...await original<typeof import('@tanstack/react-query')>(), useQuery: () => ({}) }));
vi.mock('@/stores/context', () => ({ useContextStore: () => ({
  activeWorkspace: { id:'w', name:'Workspace' }, activeEnvironment: { id:'e',workspace_id:'w',name:'Environment',user_role:'owner' },
  activeGroup: fixture.activeGroup,
}) }));
vi.mock('@/stores/auth', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({user:{id:'a',is_superadmin:false}}) }));
vi.mock('@/api/queries/users', () => ({
  useWorkspaceUsers: () => ({ data: [
    {id:'a',email:'actor@example.invalid',role:'owner',access_scope:'scoped',group_assignments:[{environment_id:'e',group_id:'p',role:'owner'}]},
    {id:'b',email:'other@example.invalid',role:'member',access_scope:'scoped',group_assignments:[{environment_id:'e',group_id:'p',role:'member'}]},
  ] }),
  useUserManagementControls: () => ({ data: fixture.controls, isError: fixture.failed }),
  useBulkWorkspaceUsersAction: () => ({}),
  useInviteUser: () => ({ mutateAsync: fixture.invite }),
}));
vi.mock('@/api/queries/groups', () => ({ useGroups: () => ({data:[
  {id:'a',name:'Admin parent',environment_id:'e',depth:0},
  {id:'b',name:'Owner subtree',environment_id:'e',depth:1},
  {id:'c',name:'Viewer sibling',environment_id:'e',depth:0},
]}) }));
vi.mock('@/components/users/UserAccessAssignmentsModal', () => ({default:({ currentUserRole,currentEnvironmentRole }: {currentUserRole:string;currentEnvironmentRole:string}) =>
  <div role="dialog">{currentUserRole}/{currentEnvironmentRole}</div>}));

beforeEach(() => {
  fixture.activeGroup = null;
  fixture.failed = false;
  fixture.invite.mockReset().mockResolvedValue({});
  fixture.controls = {workspace_invite:null,environment_invite:null,workspace_manage:null,environment_manage:null,group_invites:{a:'admin',b:'owner'}};
});
describe('scoped Users controls', () => {
  it('allows only manageable subtrees in All groups and derives the role list from the selected group', async () => {
    const user = userEvent.setup(); render(<Users/>);
    expect(screen.queryByRole('button',{name:'Manage Access'})).toBeNull();
    await user.click(screen.getByRole('button',{name:'Invite User'}));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('radio',{name:/workspace-wide/i})).toBeDisabled();
    expect(dialog.getByRole('radio',{name:/^current environment/i})).toBeDisabled();
    expect(dialog.getByRole('radio',{name:/specific group/i})).toBeChecked();
    expect(dialog.queryByRole('option',{name:'Viewer sibling'})).toBeNull();
    expect(dialog.queryByRole('option',{name:'Owner'})).toBeNull();
    await user.selectOptions(dialog.getByLabelText('Invite group'),'b');
    await user.selectOptions(dialog.getByLabelText('Role'),'owner');
    await user.type(dialog.getByLabelText('Email'),'fixture@example.invalid');
    await user.click(dialog.getByRole('button',{name:'Send Invite'}));
    expect(fixture.invite).toHaveBeenCalledWith({workspace_id:'w',role:'owner',email:'fixture@example.invalid',environment_ids:[],group_ids:['b']});
  });
  it('uses the permitted active group and resets an excessive role after a scope change', async () => {
    fixture.activeGroup={id:'b',environment_id:'e',name:'Owner subtree'};
    const user=userEvent.setup();render(<Users/>);
    await user.click(screen.getByRole('button',{name:'Invite User'}));
    expect(screen.getByLabelText('Invite group')).toHaveValue('b');
    await user.selectOptions(screen.getByLabelText('Role'),'owner');
    await user.selectOptions(screen.getByLabelText('Invite group'),'a');
    expect(screen.getByLabelText('Role')).toHaveValue('member');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('requires an explicit replacement when the selected invitation group becomes unavailable', async () => {
    const user = userEvent.setup();
    const page = render(<Users/>);
    await user.click(screen.getByRole('button',{name:'Invite User'}));
    await user.type(screen.getByLabelText('Email'),'fixture@example.invalid');
    expect(screen.getByLabelText('Invite group')).toHaveValue('a');
    fixture.controls = {...fixture.controls!, group_invites:{b:'owner'}};
    page.rerender(<Users/>);
    expect(screen.getByLabelText('Invite group')).toHaveValue('');
    expect(screen.getByRole('button',{name:'Send Invite'})).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Invite group'),'b');
    expect(screen.getByRole('button',{name:'Send Invite'})).toBeEnabled();
    expect(screen.getByLabelText('Email')).toHaveValue('fixture@example.invalid');
  });
  it('opens Manage Access with only the exact environment management role',async()=>{
    fixture.controls!.environment_manage='admin';
    const user=userEvent.setup();render(<Users/>);
    await user.click(screen.getByRole('button',{name:'Manage Access'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('viewer/admin');
  });
  it('withholds both controls on a failed authority refresh, even with stale cached grants',()=>{
    fixture.failed=true;render(<Users/>);
    expect(screen.getByRole('status')).toHaveTextContent('Unable to load user management permissions');
    expect(screen.queryByRole('button',{name:'Invite User'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Manage Access'})).toBeNull();
  });
});
