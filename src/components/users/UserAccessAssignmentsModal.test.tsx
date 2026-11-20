import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserAccessAssignmentsModal from './UserAccessAssignmentsModal';
import { apiClient } from '@/api/client';

vi.mock('@/api/client',()=>({apiClient:{get:vi.fn(),put:vi.fn(),delete:vi.fn()}}));

describe('membership editor lifecycle',()=>{
  beforeEach(()=>vi.resetAllMocks());
  afterEach(()=>vi.restoreAllMocks());
  it('saves role and scope together, preserves child roles and refreshes its own access summary',async()=>{
    let role='viewer';
    let resolveGroups!: () => void;
    const groupResponse = new Promise<void>((resolve) => {
      resolveGroups = resolve;
    });
    vi.mocked(apiClient.get).mockImplementation(async path=>{
      if(path.startsWith('/api/workspaces/users')) return {users:[{id:'target',email:'target@fixture.invalid',role,access_scope:'scoped',environment_assignments:[{environment_id:'env',environment_name:'Fixture environment',role:'owner'}],group_assignments:[]}]} as never;
      if(path.startsWith('/api/environments')) return {environments:[{id:'env',name:'Fixture environment'}]} as never;
      await groupResponse;
      return {groups:[]} as never;
    });
    vi.mocked(apiClient.put).mockImplementation(async (_path,body)=>{role=(body as {workspace_role:string}).workspace_role;return {message:'updated'} as never;});
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    render(<QueryClientProvider client={client}><UserAccessAssignmentsModal open workspaceId="ws" userId="target" currentUserRole="owner" isSuperadmin={false} canManageWorkspaceUsers onClose={()=>{}} /></QueryClientProvider>);
    await screen.findByText(/Workspace RBAC role:/);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    resolveGroups();

    const [workspaceRole] = await screen.findAllByRole('combobox');
    const user=userEvent.setup();
    await user.selectOptions(workspaceRole,'member');
    await user.click(screen.getByRole('button',{name:'Save Access'}));
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(apiClient.put).toHaveBeenCalledWith('/api/workspaces/users/access',expect.objectContaining({workspace_role:'member',environment_ids:['env'],scoped_role:undefined}));
    await waitFor(()=>expect(screen.getByText(/Workspace RBAC role:/).textContent).toContain('member'));
    expect(screen.getByText(/Scoped environment RBAC:/).textContent).toContain('owner');
  });

  async function removalEditor() {
    vi.mocked(apiClient.get).mockImplementation(async path => {
      if (path.startsWith('/api/workspaces/users')) return {users:[{
        id:'target',email:'target@fixture.invalid',role:'member',access_scope:'workspace',
        environment_assignments:[],group_assignments:[],
      }]} as never;
      return {environments:[]} as never;
    });
    const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const editor = (open: boolean) => <QueryClientProvider client={client}>
      <UserAccessAssignmentsModal open={open} workspaceId="ws" userId="target"
        currentUserRole="owner" isSuperadmin={false} canManageWorkspaceUsers
        onClose={onClose} onSaved={onSaved}/>
    </QueryClientProvider>;
    const rendered = render(editor(true));
    await screen.findByRole('button',{name:'Remove User'});
    return {user:userEvent.setup(),onClose,onSaved,rendered,editor};
  }

  it('keeps pending invitation cancellation false until explicitly selected',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    vi.mocked(apiClient.delete).mockRejectedValue(new Error('Explicitly confirm cancellation'));
    const {user,onClose,onSaved} = await removalEditor();
    expect(screen.getByRole('checkbox',{name:/Cancel affected pending invitations/})).not.toBeChecked();
    await user.click(screen.getByRole('button',{name:'Remove User'}));
    expect(apiClient.delete).toHaveBeenCalledWith('/api/workspaces/users/target?workspace_id=ws&cancel_pending_invites=false');
    await screen.findByText('Explicitly confirm cancellation');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the selected cancellation through the real removal hook and retains it for a failed retry',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(true);
    vi.mocked(apiClient.delete).mockRejectedValueOnce(new Error('Synthetic retryable failure')).mockResolvedValue({message:'removed'} as never);
    const {user,onClose,onSaved} = await removalEditor();
    const confirmation = screen.getByRole('checkbox',{name:/Cancel affected pending invitations/});
    await user.click(confirmation);
    await user.click(screen.getByRole('button',{name:'Remove User'}));
    await screen.findByText('Synthetic retryable failure');
    expect(confirmation).toBeChecked();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'Remove User'}));
    await waitFor(()=>expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(apiClient.delete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient.delete).mock.calls.map(([path])=>path)).toEqual([
      '/api/workspaces/users/target?workspace_id=ws&cancel_pending_invites=true',
      '/api/workspaces/users/target?workspace_id=ws&cancel_pending_invites=true',
    ]);
  });

  it('does not remove after a dismissed confirmation and resets consent when reopened',async()=>{
    vi.spyOn(window,'confirm').mockReturnValue(false);
    const {user,rendered,editor,onClose} = await removalEditor();
    await user.click(screen.getByRole('checkbox',{name:/Cancel affected pending invitations/}));
    await user.click(screen.getByRole('button',{name:'Remove User'}));
    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    rendered.rerender(editor(false));
    rendered.rerender(editor(true));
    await waitFor(()=>expect(screen.getByRole('checkbox',{name:/Cancel affected pending invitations/})).not.toBeChecked());
  });
});
