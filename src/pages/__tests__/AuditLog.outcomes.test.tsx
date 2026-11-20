import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
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
  client=queryClient;client.clear();onlineManager.setOnline(true);
});
afterEach(()=>{onlineManager.setOnline(true);client.clear();});

describe('audit history outcomes',()=>{
  it.each([403,503])('does not describe an initial %s as healthy empty history',async status=>{
    vi.mocked(apiClient.get).mockRejectedValue(new ApiError('Synthetic failure',status));
    show();await screen.findByRole('alert');
    expect(screen.queryByText('No audit entries found.')).not.toBeInTheDocument();
    expect(live()).not.toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('button',{name:'Retry audit log'})).toBeEnabled());
    expect(apiClient.get).toHaveBeenCalledTimes(status===403?1:2);
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

  it('describes an offline paused initial request without claiming empty or live history',async()=>{
    onlineManager.setOnline(false);show();
    expect(await screen.findByRole('status')).toHaveTextContent('waiting for a network connection');
    expect(apiClient.get).not.toHaveBeenCalled();expect(live()).not.toBeInTheDocument();
    expect(screen.queryByText('No audit entries found.')).not.toBeInTheDocument();
  });

  it('hides cached rows on the first failed refresh while a transient automatic retry waits',async()=>{
    vi.mocked(apiClient.get).mockResolvedValueOnce({entries:[row],total:1}).mockRejectedValue(new ApiError('Synthetic transient',503));
    show();await screen.findByText('Synthetic policy');
    await act(async()=>{void client.invalidateQueries({queryKey:auditKeys.all});});
    await screen.findByRole('alert');
    expect(client.getQueryCache().find({queryKey:auditKeys.list({environment_id:fixture.environment,page:1,per_page:25,action:undefined})})?.state.fetchFailureCount).toBe(1);
    expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument();expect(live()).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Retry audit log'})).toBeDisabled();
  });

  it('requires a fresh request when returning to a cached filter after permission denial',async()=>{
    vi.mocked(apiClient.get).mockResolvedValueOnce({entries:[row],total:1}).mockRejectedValue(new ApiError('Synthetic denied',403));
    show();await screen.findByText('Synthetic policy');
    const user=userEvent.setup();const filter=screen.getByRole('combobox',{name:'Filter audit action'});
    await user.selectOptions(filter,'auth.login');await screen.findByRole('alert');
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    await user.selectOptions(filter,'');await screen.findByRole('alert');
    expect(apiClient.get).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument();expect(live()).not.toBeInTheDocument();
  });

  it('applies a delayed denial to the cached filter that became active meanwhile',async()=>{
    let deny!: (reason: unknown)=>void;
    vi.mocked(apiClient.get).mockResolvedValueOnce({entries:[row],total:1}).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{deny=reject;}));
    show();await screen.findByText('Synthetic policy');
    const user=userEvent.setup(),filter=screen.getByRole('combobox',{name:'Filter audit action'});
    await user.selectOptions(filter,'auth.login');await user.selectOptions(filter,'');
    await screen.findByText('Synthetic policy');
    await act(async()=>deny(new ApiError('Synthetic denied',403)));
    await screen.findByRole('alert');expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument();expect(live()).not.toBeInTheDocument();
    vi.mocked(apiClient.get).mockResolvedValue({entries:[row],total:1});
    await user.click(screen.getByRole('button',{name:'Retry audit log'}));
    await screen.findByText('Synthetic policy');expect(live()).toBeInTheDocument();
  });

  it('does not let an older denial override a newer authoritative success',async()=>{
    let deny!: (reason: unknown)=>void;
    vi.mocked(apiClient.get).mockResolvedValueOnce({entries:[row],total:1}).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{deny=reject;})).mockResolvedValue({entries:[row],total:1});
    show();await screen.findByText('Synthetic policy');
    const user=userEvent.setup(),filter=screen.getByRole('combobox',{name:'Filter audit action'});
    await user.selectOptions(filter,'auth.login');await user.selectOptions(filter,'');
    await act(async()=>{await client.refetchQueries({queryKey:auditKeys.all,type:'active'});});
    await act(async()=>deny(new ApiError('Older synthetic denied',403)));
    expect(screen.getByText('Synthetic policy')).toBeInTheDocument();expect(live()).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not let an older in-flight success undo a newer denial',async()=>{
    let succeed!: (value:unknown)=>void,deny!: (reason:unknown)=>void;
    vi.mocked(apiClient.get).mockImplementationOnce(()=>new Promise(resolve=>{succeed=resolve;})).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{deny=reject;}));
    show();const user=userEvent.setup(),filter=screen.getByRole('combobox',{name:'Filter audit action'});
    await user.selectOptions(filter,'auth.login');await user.selectOptions(filter,'');
    await act(async()=>deny(new ApiError('Newer synthetic denied',403)));await screen.findByRole('alert');
    await act(async()=>succeed({entries:[row],total:1}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Retry audit log'})).toBeEnabled());
    expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument();expect(live()).not.toBeInTheDocument();expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('keeps the denial watermark after a newer filter recovers',async()=>{
    let succeed!: (value:unknown)=>void,deny!: (reason:unknown)=>void;
    vi.mocked(apiClient.get).mockImplementationOnce(()=>new Promise(resolve=>{succeed=resolve;})).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{deny=reject;})).mockResolvedValue({entries:[],total:0});
    show();const user=userEvent.setup(),filter=screen.getByRole('combobox',{name:'Filter audit action'});
    await user.selectOptions(filter,'auth.login');await user.selectOptions(filter,'');
    await act(async()=>deny(new ApiError('Newer synthetic denied',403)));await screen.findByRole('alert');
    await user.selectOptions(filter,'policy.create');await screen.findByText('No audit entries found.');expect(live()).toBeInTheDocument();
    await user.selectOptions(filter,'');await act(async()=>succeed({entries:[row],total:1}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Retry audit log'})).toBeEnabled());
    expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument();expect(live()).not.toBeInTheDocument();expect(apiClient.get).toHaveBeenCalledTimes(3);
  });

  it('retains a middle denial that arrives after a newer filter has already recovered',async()=>{
    let succeed!: (value:unknown)=>void,deny!: (reason:unknown)=>void;
    vi.mocked(apiClient.get).mockImplementationOnce(()=>new Promise(resolve=>{succeed=resolve;})).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{deny=reject;})).mockResolvedValue({entries:[],total:0});
    show();const user=userEvent.setup(),filter=screen.getByRole('combobox',{name:'Filter audit action'});
    await user.selectOptions(filter,'auth.login');await user.selectOptions(filter,'policy.create');
    await screen.findByText('No audit entries found.');expect(live()).toBeInTheDocument();
    await act(async()=>deny(new ApiError('Middle synthetic denied',403)));
    expect(live()).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.selectOptions(filter,'');await act(async()=>succeed({entries:[row],total:1}));
    expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument();
  });

  it('preserves unrelated environment caches when an audit request fails',async()=>{
    const other={environment_id:'other-fixture-environment',page:1,per_page:25};
    client.setQueryData(auditKeys.list(other),{entries:[{...row,environment_id:other.environment_id}],total:1});
    vi.mocked(apiClient.get).mockRejectedValue(new ApiError('Synthetic denied',403));show();await screen.findByRole('alert');
    expect(client.getQueryData(auditKeys.list(other))).toEqual({entries:[{...row,environment_id:other.environment_id}],total:1});
  });

  it('does not show the prior environment rows while the new environment is loading',async()=>{
    let release!: (value: unknown)=>void;
    vi.mocked(apiClient.get).mockResolvedValueOnce({entries:[row],total:1}).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const view=show();await screen.findByText('Synthetic policy');fixture.environment='other-fixture-environment';view.rerender(view.tree());
    await waitFor(()=>expect(screen.queryByText('Synthetic policy')).not.toBeInTheDocument());expect(live()).not.toBeInTheDocument();
    await act(async()=>release({entries:[],total:0}));await screen.findByText('No audit entries found.');expect(live()).toBeInTheDocument();
  });
});
