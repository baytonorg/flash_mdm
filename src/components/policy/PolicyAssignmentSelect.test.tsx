import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PolicyAssignmentSelect from './PolicyAssignmentSelect';
const state=vi.hoisted(()=>({assign:{mutateAsync:vi.fn(),isPending:false,isError:false,error:null as Error|null},unassign:{mutateAsync:vi.fn(),isPending:false,isError:false,error:null as Error|null}}));
vi.mock('@/api/queries/policies',()=>({usePolicies:()=>({data:[{id:'policy',name:'Current policy'}],isLoading:false}),useAssignPolicy:()=>state.assign,useUnassignPolicy:()=>state.unassign}));
const props={scopeType:'group' as const,scopeId:'group',environmentId:'environment',currentPolicyId:'policy'};
describe('policy assignment and inherited revert controls',()=>{
  beforeEach(()=>{state.assign.mutateAsync.mockReset().mockResolvedValue({});state.unassign.mutateAsync.mockReset().mockResolvedValue({});state.assign.isError=false;state.assign.error=null;state.assign.isPending=false;state.unassign.isError=false;state.unassign.error=null;});
  it('can explicitly make the same inherited policy direct without changing payload',async()=>{
    const user=userEvent.setup();const assigned=vi.fn();render(<PolicyAssignmentSelect {...props} currentSource="environment" onAssigned={assigned}/>);
    await user.click(screen.getByRole('button',{name:'Assign here'}));
    expect(state.assign.mutateAsync).toHaveBeenCalledWith({policy_id:'policy',scope_type:'group',scope_id:'group'});expect(assigned).toHaveBeenCalledOnce();
  });
  it('allows direct group revert and retains a useful permission denial',async()=>{
    const user=userEvent.setup();const assigned=vi.fn();state.unassign.mutateAsync.mockRejectedValue(new Error('Requires Admin access'));
    const view=render(<PolicyAssignmentSelect {...props} currentSource="group" onAssigned={assigned}/>);
    await user.click(screen.getByRole('button',{name:'Revert to inherited policy'}));
    expect(state.unassign.mutateAsync).toHaveBeenCalledWith({scope_type:'group',scope_id:'group'});expect(assigned).not.toHaveBeenCalled();
    state.unassign.isError=true;state.unassign.error=new Error('Requires Admin access');view.rerender(<PolicyAssignmentSelect {...props} currentSource="group"/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Requires Admin access');
  });
  it('disables the inherited direct-assignment action while a save is pending',()=>{
    state.assign.isPending=true;render(<PolicyAssignmentSelect {...props} currentSource="environment"/>);
    expect(screen.getByRole('button',{name:'Assign here'})).toBeDisabled();expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
