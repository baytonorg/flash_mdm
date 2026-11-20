import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {QueryClientProvider} from '@tanstack/react-query';
import {queryClient} from '@/lib/queryClient';
import {ApiKeyScopePanel} from '../Settings';
import {apiClient} from '@/api/client';
const fixture=vi.hoisted(()=>({user:{id:'operator-one',is_superadmin:false,impersonation:undefined as undefined|{active:boolean;mode:'full'|'read_only';by_user_id:string}},workspace:{id:'workspace-one'}}));
vi.mock('@/stores/auth',()=>({useAuthStore:()=>({user:fixture.user})}));
vi.mock('@/stores/context',()=>({useContextStore:()=>({activeWorkspace:fixture.workspace})}));
vi.mock('@/api/client',async original=>({...await original<typeof import('@/api/client')>(),apiClient:{get:vi.fn(),post:vi.fn()}}));
const sentinel='inert-one-time-value';
let clipboard:ReturnType<typeof vi.fn>;
const props={title:'Workspace keys',description:'Synthetic fixture',scopeType:'workspace' as 'workspace'|'environment',scopeId:'workspace-one',canCreate:true,canView:true,maxRole:'owner' as const};
function response(overrides:Record<string,unknown>={}){return {api_key:{id:'inert-key-record',scope_type:props.scopeType,workspace_id:fixture.workspace.id,environment_id:props.scopeType==='environment'?props.scopeId:null,name:'Synthetic key',token:sentinel,token_prefix:'inert',expires_at:null,...overrides}};}
function show(){const tree=()=> <QueryClientProvider client={queryClient}><ApiKeyScopePanel {...props}/></QueryClientProvider>;return {...render(tree()),tree};}
async function generate(){fireEvent.change(screen.getByPlaceholderText(/Local integration/),{target:{value:'Synthetic key'}});fireEvent.click(screen.getByRole('button',{name:'Generate API Key'}));}
beforeEach(()=>{
 queryClient.clear();Object.assign(props,{title:'Workspace keys',scopeType:'workspace',scopeId:'workspace-one',canCreate:true,canView:true,maxRole:'owner'});fixture.workspace={id:'workspace-one'};fixture.user={id:'operator-one',is_superadmin:false,impersonation:undefined};
 vi.mocked(apiClient.get).mockReset().mockImplementation(async url=>({api_keys:[{id:String(url),name:'Masked list row '+String(url),role:'owner',token:null,token_prefix:'inert-list',created_at:'2026-11-20T09:00:00Z',expires_at:null,last_used_at:null}]}));
 vi.mocked(apiClient.post).mockReset().mockImplementation(async()=>response());
 clipboard=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:clipboard}});
});
afterEach(()=>{queryClient.clear();});

describe('one-time key handoff stays in its issuing context',()=>{
 it('shows the authorised result once, copies only after success and keeps list rows masked',async()=>{
  show();await generate();await screen.findByText(sentinel);expect(screen.getByText('New API key (shown once)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Copy'}));await screen.findByText('Copied API key "Synthetic key" to clipboard.');expect(clipboard).toHaveBeenCalledWith(sentinel);
  expect(apiClient.post).toHaveBeenCalledTimes(1);expect(vi.mocked(apiClient.post).mock.calls[0][0]).toBe('/api/api-keys/create');
 });
 it('reports clipboard failure without a false copied message or a second creation',async()=>{
  clipboard.mockRejectedValue(new Error('inert clipboard failure'));show();await generate();await screen.findByText(sentinel);fireEvent.click(screen.getByRole('button',{name:'Copy'}));
  await screen.findByText('Unable to copy the API key. Select and copy the value manually.');expect(screen.queryByText(/Copied API key/)).not.toBeInTheDocument();expect(apiClient.post).toHaveBeenCalledTimes(1);
 });
 it.each(['workspace','environment'] as const)('dismisses an issued %s value on departure and does not restore it on return',async scope=>{
  props.scopeType=scope;props.scopeId=scope==='workspace'?'workspace-one':'environment-one';const first=props.scopeId;const view=show();await generate();await screen.findByText(sentinel);
  if(scope==='workspace')fixture.workspace={id:'workspace-two'};props.scopeId=scope==='workspace'?'workspace-two':'environment-two';view.rerender(view.tree());expect(screen.queryByText(sentinel)).not.toBeInTheDocument();
  fixture.workspace={id:'workspace-one'};props.scopeId=first;view.rerender(view.tree());expect(screen.queryByText(sentinel)).not.toBeInTheDocument();
  await waitFor(()=>expect(JSON.stringify(queryClient.getMutationCache().getAll().map(m=>m.state.data))).not.toContain(sentinel));expect(apiClient.post).toHaveBeenCalledTimes(1);
 });
 it.each(['identity','create-access','view-access','role-ceiling','platform-role','support-mode','support-operator'] as const)('dismisses on %s change without a scope change',async change=>{
  if(change==='support-mode'||change==='support-operator')fixture.user={...fixture.user,impersonation:{active:true,mode:'full',by_user_id:'support-one'}};
  const view=show();await generate();await screen.findByText(sentinel);
  if(change==='platform-role')fixture.user={...fixture.user,is_superadmin:true};
  if(change==='identity')fixture.user={...fixture.user,id:'operator-two'};
  if(change==='create-access')props.canCreate=false;
  if(change==='view-access')props.canView=false;
  if(change==='role-ceiling')Object.assign(props,{maxRole:'admin'});
  if(change==='support-mode')fixture.user={...fixture.user,impersonation:{active:true,mode:'read_only',by_user_id:'support-one'}};
  if(change==='support-operator')fixture.user={...fixture.user,impersonation:{active:true,mode:'full',by_user_id:'support-two'}};
  view.rerender(view.tree());expect(screen.queryByText(sentinel)).not.toBeInTheDocument();expect(screen.queryByText(/API key created:/)).not.toBeInTheDocument();
 });
 it.each(['success','failure'] as const)('does not deliver a delayed %s into a different scope',async outcome=>{
  let resolve!:(v:unknown)=>void,reject!:(e:unknown)=>void;const issued=response();vi.mocked(apiClient.post).mockImplementation(()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
  const view=show();await generate();expect(await screen.findByText(/Leaving dismisses its one-time value/)).toBeInTheDocument();
  fixture.workspace={id:'workspace-two'};props.scopeId='workspace-two';view.rerender(view.tree());
  await act(async()=>outcome==='success'?resolve(issued):reject(new Error('Inert old-scope failure')));
  expect(screen.queryByText(sentinel)).not.toBeInTheDocument();expect(screen.queryByText('Inert old-scope failure')).not.toBeInTheDocument();
  fixture.workspace={id:'workspace-one'};props.scopeId='workspace-one';view.rerender(view.tree());expect(screen.queryByText(sentinel)).not.toBeInTheDocument();
  await waitFor(()=>expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
 });
 it('drops a delayed response across departure and return to the same scope',async()=>{
  let resolve!:(v:unknown)=>void;const issued=response();vi.mocked(apiClient.post).mockImplementation(()=>new Promise(yes=>{resolve=yes;}));const view=show();await generate();
  fixture.workspace={id:'workspace-two'};props.scopeId='workspace-two';view.rerender(view.tree());fixture.workspace={id:'workspace-one'};props.scopeId='workspace-one';view.rerender(view.tree());
  await act(async()=>resolve(issued));expect(screen.queryByText(sentinel)).not.toBeInTheDocument();
 });
 it('does not claim a full handoff when the response has no value or a different scope',async()=>{
  vi.mocked(apiClient.post).mockResolvedValueOnce(response({token:null}));show();await generate();await screen.findByText(/full value was not returned/);expect(screen.queryByText(sentinel)).not.toBeInTheDocument();
  vi.mocked(apiClient.post).mockResolvedValueOnce(response({workspace_id:'other-workspace'}));await generate();await screen.findByText(/did not match this scope/);expect(screen.queryByText(sentinel)).not.toBeInTheDocument();expect(apiClient.post).toHaveBeenCalledTimes(2);
 });
 it('suppresses duplicate submissions while the same create remains unresolved',async()=>{
  let resolve!:(v:unknown)=>void;const issued=response();vi.mocked(apiClient.post).mockImplementation(()=>new Promise(yes=>{resolve=yes;}));show();await generate();
  const form=screen.getByPlaceholderText(/Local integration/).closest('form')!;fireEvent.submit(form);fireEvent.submit(form);expect(apiClient.post).toHaveBeenCalledTimes(1);await act(async()=>resolve(issued));await screen.findByText(sentinel);
 });
 it('dismisses the value when the authenticated identity disappears',async()=>{
  const view=show();await generate();await screen.findByText(sentinel);Object.assign(fixture,{user:null});view.rerender(view.tree());expect(screen.queryByText(sentinel)).not.toBeInTheDocument();expect(screen.queryByText('Workspace keys')).not.toBeInTheDocument();
 });
 it('removes only its own completed mutation from the shared cache',async()=>{
  const unrelated=queryClient.getMutationCache().build(queryClient,{mutationKey:['inert-unrelated'],mutationFn:async()=>({kept:'inert-peer'})});await unrelated.execute(undefined);
  show();await generate();await screen.findByText(sentinel);expect(queryClient.getMutationCache().getAll()).toEqual([unrelated]);
 });
 it('rejects a mismatched environment response in the same workspace',async()=>{
  props.scopeType='environment';props.scopeId='environment-one';vi.mocked(apiClient.post).mockResolvedValueOnce(response({environment_id:'environment-two'}));show();await generate();await screen.findByText(/did not match this scope/);expect(screen.queryByText(sentinel)).not.toBeInTheDocument();
 });
 it('never automatically repeats creation even when the client config enables mutation retries',async()=>{
  const defaults=queryClient.getDefaultOptions();queryClient.setDefaultOptions({...defaults,mutations:{retry:2}});
  try{vi.mocked(apiClient.post).mockRejectedValue(new Error('Inert uncertain result'));show();await generate();await screen.findByText('Inert uncertain result');expect(apiClient.post).toHaveBeenCalledTimes(1);}
  finally{queryClient.setDefaultOptions(defaults);}
 });
 it('keeps the existing list query isolated by scope and never supplies full values through it',async()=>{
  const view=show();await screen.findByText(/Masked list row.*workspace-one/);fixture.workspace={id:'workspace-two'};props.scopeId='workspace-two';view.rerender(view.tree());await screen.findByText(/Masked list row.*workspace-two/);
  expect(screen.queryByText(/Masked list row.*workspace-one/)).not.toBeInTheDocument();expect(screen.queryByText(sentinel)).not.toBeInTheDocument();expect(apiClient.post).not.toHaveBeenCalled();
 });
});
