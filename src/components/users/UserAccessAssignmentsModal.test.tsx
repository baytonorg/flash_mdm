import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserAccessAssignmentsModal from './UserAccessAssignmentsModal';
import { apiClient } from '@/api/client';

vi.mock('@/api/client',()=>({apiClient:{get:vi.fn(),put:vi.fn(),delete:vi.fn()}}));

describe('membership editor lifecycle',()=>{
  beforeEach(()=>vi.resetAllMocks());
  it('saves role and scope together, preserves child roles and refreshes its own access summary',async()=>{
    let role='viewer';
    vi.mocked(apiClient.get).mockImplementation(async path=>{
      if(path.startsWith('/api/workspaces/users')) return {users:[{id:'target',email:'target@fixture.invalid',role,access_scope:'scoped',environment_assignments:[{environment_id:'env',environment_name:'Fixture environment',role:'owner'}],group_assignments:[]}]} as never;
      if(path.startsWith('/api/environments')) return {environments:[{id:'env',name:'Fixture environment'}]} as never;
      return {groups:[]} as never;
    });
    vi.mocked(apiClient.put).mockImplementation(async (_path,body)=>{role=(body as {workspace_role:string}).workspace_role;return {message:'updated'} as never;});
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    render(<QueryClientProvider client={client}><UserAccessAssignmentsModal open workspaceId="ws" userId="target" currentUserRole="owner" isSuperadmin={false} canManageWorkspaceUsers onClose={()=>{}} /></QueryClientProvider>);
    await screen.findByText(/Workspace RBAC role:/);
    const user=userEvent.setup();
    await user.selectOptions(screen.getAllByRole('combobox')[0],'member');
    await user.click(screen.getByRole('button',{name:'Save Access'}));
    expect(apiClient.put).toHaveBeenCalledTimes(1);
    expect(apiClient.put).toHaveBeenCalledWith('/api/workspaces/users/access',expect.objectContaining({workspace_role:'member',environment_ids:['env'],scoped_role:undefined}));
    await waitFor(()=>expect(screen.getByText(/Workspace RBAC role:/).textContent).toContain('member'));
    expect(screen.getByText(/Scoped environment RBAC:/).textContent).toContain('owner');
  });
});
