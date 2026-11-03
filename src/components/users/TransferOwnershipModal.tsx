import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import type { WorkspaceUser } from '@/api/queries/users';

export default function TransferOwnershipModal({workspaceId, userId, onClose}: {workspaceId:string;userId:string;onClose:()=>void}) {
  const client = useQueryClient();
  const [successor,setSuccessor]=useState('');
  const [outcome,setOutcome]=useState('admin');
  const [consent,setConsent]=useState(false);
  const [cancelInvites,setCancelInvites]=useState(false);
  const members=useQuery({queryKey:['workspace-users',workspaceId,'transfer'],queryFn:()=>apiClient.get<{users:WorkspaceUser[]}>(`/api/workspaces/users?workspace_id=${workspaceId}`)});
  const transfer=useMutation({mutationFn:()=>apiClient.post('/api/workspaces/users/transfer-ownership',{
    workspace_id:workspaceId,successor_id:successor,previous_owner_role:outcome,successor_consent_acknowledged:consent,cancel_pending_invites:cancelInvites,
  }),onSuccess:async()=>{await client.invalidateQueries({queryKey:['workspace-users',workspaceId]});window.location.assign('/');}});
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-labelledby="transfer-title" className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
    <h2 id="transfer-title" className="text-lg font-semibold">Transfer workspace ownership</h2>
    <p className="mt-2 text-sm text-gray-700">The successor receives workspace-wide Owner access. Your selected role or removal takes effect in the same transaction. Existing direct child roles and independent API keys are preserved.</p>
    <label className="mt-4 block text-sm">Successor<select className="mt-1 w-full rounded border p-2" value={successor} onChange={e=>setSuccessor(e.target.value)}><option value="">Select an existing member</option>{members.data?.users.filter(u=>u.id!==userId).map(u=><option key={u.id} value={u.id}>{u.email} ({u.role}, {u.access_scope ?? 'workspace'})</option>)}</select></label>
    <label className="mt-3 block text-sm">My workspace access afterwards<select className="mt-1 w-full rounded border p-2" value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option><option value="leave">Leave this workspace</option></select></label>
    <p className="mt-2 text-xs text-gray-600">A lower workspace role can still retain stronger direct environment or group grants. Leaving removes all of your grants in this workspace.</p>
    <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />I have confirmed that this member agrees to workspace-wide ownership.</label>
    {outcome==='leave' && <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={cancelInvites} onChange={e=>setCancelInvites(e.target.checked)} />Cancel any pending invitations addressed to me in this workspace.</label>}
    {(members.error || transfer.error) && <p className="mt-3 text-sm text-red-700">{String((transfer.error ?? members.error)?.message)}</p>}
    <div className="mt-5 flex justify-end gap-2"><button className="rounded border px-3 py-2 text-sm" onClick={onClose} disabled={transfer.isPending}>Cancel</button><button className="rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-50" disabled={!successor||!consent||members.isFetching||!!members.error||transfer.isPending} onClick={()=>transfer.mutate()}>{transfer.isPending?'Transferring...':'Transfer ownership'}</button></div>
  </div></div>;
}
