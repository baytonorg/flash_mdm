import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LockControls from './LockControls';
const state=vi.hoisted(()=>({mutateAsync:vi.fn(),isPending:false}));
vi.mock('@/api/queries/policies',()=>({useSetPolicyLocks:()=>state}));
const props={policyId:'policy',scopeType:'group' as const,scopeId:'group',currentLocked:false,currentLockedSections:[] as string[],assignmentVersion:'a'.repeat(32)};
describe('policy lock editing generation and usability',()=>{
  beforeEach(()=>{state.mutateAsync.mockReset().mockResolvedValue({});state.isPending=false;});
  it('supports keyboard editing and saves the displayed version',async()=>{
    const user=userEvent.setup();render(<LockControls {...props}/>);
    const toggle=screen.getByRole('switch',{name:'Lock entire policy'});toggle.focus();
    await user.keyboard(' ');expect(toggle).toHaveAttribute('aria-checked','true');
    await user.click(screen.getByRole('button',{name:'Save locks'}));
    expect(state.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({expected_version:props.assignmentVersion,locked:true}));
  });
  it('refuses dirty edits after a background assignment refetch',async()=>{
    const user=userEvent.setup();const view=render(<LockControls {...props}/>);
    await user.click(screen.getByRole('switch',{name:'Lock entire policy'}));
    view.rerender(<LockControls {...props} assignmentVersion={'b'.repeat(32)}/>);
    await user.click(screen.getByRole('button',{name:'Save locks'}));
    expect(state.mutateAsync).not.toHaveBeenCalled();expect(screen.getByText(/Close and reopen Lock Settings/)).toBeInTheDocument();
  });
  it('updates a clean baseline after refetch and permits another edit after saving',async()=>{
    const user=userEvent.setup();const view=render(<LockControls {...props}/>);
    view.rerender(<LockControls {...props} currentLocked assignmentVersion={'b'.repeat(32)}/>);
    await user.click(screen.getByRole('switch',{name:'Lock entire policy'}));
    await user.click(screen.getByRole('button',{name:'Save locks'}));
    expect(state.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({expected_version:'b'.repeat(32),locked:false}));
    view.rerender(<LockControls {...props} currentLocked={false} assignmentVersion={'c'.repeat(32)}/>);
    await user.click(screen.getByRole('switch',{name:'Lock entire policy'}));
    await user.click(screen.getByRole('button',{name:'Save locks'}));
    expect(state.mutateAsync).toHaveBeenLastCalledWith(expect.objectContaining({expected_version:'c'.repeat(32),locked:true}));
  });
  it('keeps dirty values and useful server conflict wording after a failed save',async()=>{
    state.mutateAsync.mockRejectedValue(new Error('The assignment changed. Refresh before updating its locks.'));
    const user=userEvent.setup();render(<LockControls {...props}/>);
    await user.click(screen.getByRole('switch',{name:'Lock entire policy'}));await user.click(screen.getByRole('button',{name:'Save locks'}));
    expect(screen.getByText(/Refresh before updating/)).toBeInTheDocument();expect(screen.getByRole('switch')).toHaveAttribute('aria-checked','true');
  });
  it('disables duplicate saves while loading and explains missing direct assignments',async()=>{
    const user=userEvent.setup();const view=render(<LockControls {...props} assignmentVersion={undefined}/>);
    await user.click(screen.getByRole('switch'));expect(screen.getByRole('button',{name:'Save locks'})).toBeDisabled();
    expect(screen.getByText(/Assign this policy at this scope first/)).toBeInTheDocument();
    state.isPending=true;view.rerender(<LockControls {...props}/>);expect(screen.getByRole('button',{name:'Saving...'})).toBeDisabled();
  });
});
