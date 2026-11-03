import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SuperadminUsers } from '../Superadmin';
import { apiClient } from '@/api/client';

vi.mock('@/api/client',()=>({apiClient:{get:vi.fn(),post:vi.fn()}}));

describe('superadmin deletion preflight',()=>{
  beforeEach(()=>{
    vi.resetAllMocks();
    vi.mocked(apiClient.get).mockImplementation(async path=>path.startsWith('/api/superadmin/users')?{
      users:[{id:'target',email:'target@fixture.invalid',is_superadmin:false,workspace_count:1,workspaces:[],created_at:'2026-01-01',last_login_at:null}],total:1,page:1,per_page:25,
    } as never:{workspaces:[]} as never);
  });
  const preflight=(blockers:string[]=[])=>({memberships:[{workspace_id:'ws',name:'Fixture workspace',role:'member',access_scope:'scoped',sole_owner:false}],counts:{sessions:1,support_sessions:0,pending_invites:1,independent_keys_retained:2},blockers,effects:{deletes:['Memberships and sign-in credentials'],retains:['Independent API keys and shared workspace data'],rollback:'Transactional until commit'}});
  const renderUsers=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><SuperadminUsers /></QueryClientProvider>);

  it('requires a successful preflight and every applicable explicit confirmation',async()=>{
    vi.mocked(apiClient.post).mockImplementation(async (_path,body)=>(body as {action:string}).action==='preflight_user_deletion'?preflight() as never:{message:'deleted'} as never);
    renderUsers();const user=userEvent.setup();
    await user.click(await screen.findByRole('button',{name:'Delete'}));
    await screen.findByText(/Fixture workspace/);
    const submit=screen.getByRole('button',{name:'Delete User'});
    expect(submit).toBeDisabled();
    await user.type(screen.getByRole('textbox',{name:"Type the user's email to confirm"}),'target@fixture.invalid');
    await user.click(screen.getByRole('checkbox',{name:/Delete this account's password/}));
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox',{name:/Cancel pending invitations/}));
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(()=>expect(apiClient.post).toHaveBeenCalledWith('/api/superadmin/actions',expect.objectContaining({action:'delete_user',target_id:'target',params:{confirmation_email:'target@fixture.invalid',end_sessions_and_delete_signin_credentials:true,cancel_pending_invites:true}})));
  });

  it('keeps a genuine ownership blocker visible and prevents submission',async()=>{
    vi.mocked(apiClient.post).mockResolvedValue(preflight(['Establish another owner first']) as never);
    renderUsers();const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Delete'}));
    await screen.findByText('Establish another owner first');
    await user.type(screen.getByRole('textbox',{name:"Type the user's email to confirm"}),'target@fixture.invalid');
    for(const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox);
    expect(screen.getByRole('button',{name:'Delete User'})).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalledWith('/api/superadmin/actions',expect.objectContaining({action:'delete_user'}));
  });
});
