import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditLog from '../AuditLog';
import { apiClient, ApiError } from '@/api/client';
import { auditKeys } from '@/api/queries/audit';

const fixture = vi.hoisted(()=>({environment:'fixture-environment'}));
vi.mock('@/stores/context',()=>({useContextStore:()=>({activeEnvironment:{id:fixture.environment}})}));
vi.mock('@/api/client', async original=>({...await original<typeof import('@/api/client')>(),apiClient:{get:vi.fn()}}));
let client: QueryClient;
const row = {id:'fixture-audit',environment_id:'fixture-environment',action:'policy.created',target:'Synthetic policy',actor:'Synthetic operator',created_at:'2026-11-20T09:00:00Z'};
const live = ()=>screen.queryByLabelText(/^Live page\./);
function show() {
  const tree=()=> <QueryClientProvider client={client}><AuditLog/></QueryClientProvider>;
  return {...render(tree()),tree};
}
async function refresh() {
  await act(async()=>{await client.invalidateQueries({queryKey:auditKeys.all});});
}
beforeEach(()=>{
  vi.mocked(apiClient.get).mockReset();fixture.environment='fixture-environment';
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
});
afterEach(()=>client.clear());

describe('audit history outcomes',()=>{
  it.each([403,503])('does not describe an initial %s as healthy empty history',async status=>{
    vi.mocked(apiClient.get).mockRejectedValue(new ApiError('Synthetic failure',status));
    show();await screen.findByRole('alert');
    expect(screen.queryByText('No audit entries found.')).not.toBeInTheDocument();
    expect(live()).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Retry audit log'})).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(status===403?'You do not have permission':'Unable to load audit logs');
  });

  it('shows a genuine successful empty response with the normal live indicator',async()=>{
    vi.mocked(apiClient.get).mockResolvedValue({entries:[],total:0});show();
    await screen.findByText('No audit entries found.');expect(live()).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps loading distinct from empty or live history',async()=>{
    let release!: (value: unknown)=>void;
    vi.mocked(apiClient.get).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    show();expect(live()).not.toBeInTheDocument();expect(screen.queryByText('No audit entries found.')).not.toBeInTheDocument();
    await act(async()=>release({entries:[],total:0}));await screen.findByText('No audit entries found.');expect(live()).toBeInTheDocument();
  });

  it.each([403,503])('hides cached rows and freshness after a refresh returns %s',async status=>{
    vi.mocked(apiClient.get).mockResolvedValueOnce({entries:[row],total:1}).mockRejectedValue(new ApiError('Synthetic failure',status));
    show();await screen.findByText('Synthetic policy');expect(live()).toBeInTheDocument();
    await refresh();await screen.findByRole('alert');
    expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument();expect(live()).not.toBeInTheDocument();
    expect(screen.queryByText('No audit entries found.')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(status===403?'You do not have permission':'could not be refreshed');
  });

  it('retries access with the keyboard and restores successful results and freshness',async()=>{
    vi.mocked(apiClient.get).mockRejectedValueOnce(new ApiError('Synthetic failure',503)).mockResolvedValue({entries:[row],total:1});
    show();const retry=await screen.findByRole('button',{name:'Retry audit log'});
    retry.focus();await userEvent.setup().keyboard('{Enter}');
    await screen.findByText('Synthetic policy');expect(live()).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show the prior environment rows while the new environment is loading',async()=>{
    let release!: (value: unknown)=>void;
    vi.mocked(apiClient.get).mockResolvedValueOnce({entries:[row],total:1}).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const view=show();await screen.findByText('Synthetic policy');fixture.environment='other-fixture-environment';view.rerender(view.tree());
    await waitFor(()=>expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument());expect(live()).not.toBeInTheDocument();
    await act(async()=>release({entries:[],total:0}));await screen.findByText('No audit entries found.');expect(live()).toBeInTheDocument();
  });
});
