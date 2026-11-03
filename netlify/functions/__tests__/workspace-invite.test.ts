vi.mock('../_lib/invite-membership.js', () => ({ applyInviteOffer: vi.fn().mockResolvedValue({ id: 'fixture', alreadyAccepted: false }) }));
import { applyInviteOffer } from '../_lib/invite-membership.js';
vi.mock('../_lib/invite-offer-write.js', () => ({writeInviteOffer:vi.fn(async(input)=>({id:input.inviteId,resent:false}))}));
import {writeInviteOffer} from '../_lib/invite-offer-write.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClientQuery = vi.fn();

vi.mock('../_lib/db.js', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(async (fn: (client: { query: typeof mockClientQuery }) => Promise<unknown>) => fn({ query: mockClientQuery })),
}));

vi.mock('../_lib/auth.js', () => ({
  requireAuth: vi.fn(),
  validateSession: vi.fn(),
}));

vi.mock('../_lib/rbac.js', () => ({
  requireWorkspaceRole: vi.fn(),
  requireWorkspaceResourcePermission: vi.fn(),
  getWorkspaceAccessScope: vi.fn(),
  getWorkspaceAccessScopeForAuth: vi.fn(),
  getEnvironmentRole: vi.fn(),
  getEnvironmentRoleForAuth: vi.fn(),
  getGroupRole: vi.fn(),
  getGroupRoleForAuth: vi.fn(),
}));

vi.mock('../_lib/crypto.js', () => ({
  generateToken: vi.fn(),
  hashToken: vi.fn((token: string) => `hash:${token}`),
}));

vi.mock('../_lib/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../_lib/resend.js', () => ({
  sendEmail: vi.fn(),
  inviteEmail: vi.fn(() => ({ subject: 'Invite', html: '<p>invite</p>' })),
}));

import { execute, query, queryOne, transaction } from '../_lib/db.js';
import { requireAuth } from '../_lib/auth.js';
import {
  getEnvironmentRole,
  getEnvironmentRoleForAuth,
  getGroupRole,
  getGroupRoleForAuth,
  getWorkspaceAccessScope,
  getWorkspaceAccessScopeForAuth,
  requireWorkspaceResourcePermission,
  requireWorkspaceRole,
} from '../_lib/rbac.js';
import { generateToken } from '../_lib/crypto.js';
import { logAudit } from '../_lib/audit.js';
import { inviteEmail, sendEmail } from '../_lib/resend.js';
import handler from '../workspace-invite.ts';

const mockQueryOne = vi.mocked(queryOne);
const mockQuery = vi.mocked(query);
const mockExecute = vi.mocked(execute);
const mockTransaction = vi.mocked(transaction);
const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceRole = vi.mocked(requireWorkspaceRole);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockGetWorkspaceAccessScope = vi.mocked(getWorkspaceAccessScope);
const mockGetWorkspaceAccessScopeForAuth = vi.mocked(getWorkspaceAccessScopeForAuth);
const mockGetEnvironmentRole = vi.mocked(getEnvironmentRole);
const mockGetEnvironmentRoleForAuth = vi.mocked(getEnvironmentRoleForAuth);
const mockGetGroupRole = vi.mocked(getGroupRole);
const mockGetGroupRoleForAuth = vi.mocked(getGroupRoleForAuth);
const mockGenerateToken = vi.mocked(generateToken);
const mockLogAudit = vi.mocked(logAudit);
const mockInviteEmail = vi.mocked(inviteEmail);
const mockSendEmail = vi.mocked(sendEmail);

function makeInviteRequest(body: Record<string, unknown>, origin = 'http://localhost'): Request {
  return new Request(`${origin}/api/workspaces/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeAcceptRequest(token: string): Request {
  return new Request(`http://localhost/api/invites/${token}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(writeInviteOffer).mockClear();
  mockClientQuery.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockTransaction.mockClear();
  mockRequireAuth.mockReset();
  mockRequireWorkspaceRole.mockReset();
  mockRequireWorkspaceResourcePermission.mockReset();
  mockGetWorkspaceAccessScope.mockReset();
  mockGetWorkspaceAccessScopeForAuth.mockReset();
  mockGetEnvironmentRole.mockReset();
  mockGetEnvironmentRoleForAuth.mockReset();
  mockGetGroupRole.mockReset();
  mockGetGroupRoleForAuth.mockReset();
  mockGenerateToken.mockReset();
  mockLogAudit.mockReset();
  mockInviteEmail.mockClear();
  mockSendEmail.mockReset();

  mockRequireWorkspaceRole.mockResolvedValue('admin' as never);
  mockRequireWorkspaceResourcePermission.mockResolvedValue('admin' as never);
  mockGetWorkspaceAccessScope.mockResolvedValue('workspace' as never);
  mockGetWorkspaceAccessScopeForAuth.mockResolvedValue('workspace' as never);
  mockGetEnvironmentRole.mockResolvedValue('admin' as never);
  mockGetEnvironmentRoleForAuth.mockResolvedValue('admin' as never);
  mockGetGroupRole.mockResolvedValue('admin' as never);
  mockGetGroupRoleForAuth.mockResolvedValue('admin' as never);
  mockGenerateToken.mockReturnValue('invite_token' as never);
  mockSendEmail.mockResolvedValue(undefined as never);
});

describe('workspace invite acceptance hardening', () => {
  it('rejects owner invites from non-owner workspace admins', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_admin',
      user: {
        id: 'user_admin',
        email: 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
        is_superadmin: false,
      },
    } as never);
    mockRequireWorkspaceRole.mockResolvedValue('admin' as never);

    const res = await handler(
      makeInviteRequest({
        workspace_id: 'ws_1',
        email: 'owner-candidate@example.com',
        role: 'owner',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Only owners can invite another owner',
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('re-sends an existing active workspace invite instead of blocking duplicate invite creation', async () => {
    vi.mocked(writeInviteOffer).mockResolvedValueOnce({id:'invite_existing',resent:true});
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_admin',
      user: {
        id: 'user_admin',
        email: 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
      },
    } as never);

    mockQueryOne
      .mockResolvedValueOnce(null as never) // existing member
      .mockResolvedValueOnce({ id: 'invite_existing' } as never) // active pending invite
      .mockResolvedValueOnce({ name: 'Workspace A' } as never); // workspace name

    mockExecute.mockResolvedValue(undefined as never);

    const res = await handler(
      makeInviteRequest({
        workspace_id: 'ws_1',
        email: 'person@example.com',
        role: 'member',
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ message: 'Invite re-sent', invite_id: 'invite_existing' });
    expect(writeInviteOffer).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'workspace.invite_resent' }));
  });

  it('rejects workspace-wide invites from scoped workspace admins', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_admin',
      user: {
        id: 'user_admin',
        email: 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
        is_superadmin: false,
      },
    } as never);
    mockRequireWorkspaceRole.mockResolvedValue('admin' as never);
    mockGetWorkspaceAccessScopeForAuth.mockResolvedValue('scoped' as never);

    const res = await handler(
      makeInviteRequest({
        workspace_id: 'ws_1',
        email: 'person@example.com',
        role: 'member',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Scoped users cannot send workspace-wide invites. Choose environment or group assignments.',
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('rejects platform invites from non-superadmin callers', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_admin',
      user: {
        id: 'user_admin',
        email: 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
        is_superadmin: false,
      },
    } as never);

    const res = await handler(
      makeInviteRequest({
        email: 'person@example.com',
        invite_type: 'platform_access',
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Only superadmins can send platform invites',
    });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('allows superadmin platform invites without a workspace target', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_sa',
      user: {
        id: 'user_sa',
        email: 'sa@example.com',
        first_name: 'Super',
        last_name: 'Admin',
        is_superadmin: true,
      },
    } as never);
    mockQueryOne
      .mockResolvedValueOnce(null as never); // existing invite (workspace_id IS NULL)

    const res = await handler(
      makeInviteRequest({
        email: 'msp-owner@example.com',
        invite_type: 'platform_access',
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ message: 'Invite sent' });
    expect(mockRequireWorkspaceRole).not.toHaveBeenCalled();
    expect(writeInviteOffer).toHaveBeenCalledWith(expect.objectContaining({workspaceId:null,email:'msp-owner@example.com',role:'owner'}));
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('uses the current public origin when composing an invitation URL', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_sa',
      user: {
        id: 'user_sa',
        email: 'sa@example.com',
        first_name: 'Super',
        last_name: 'Admin',
        is_superadmin: true,
      },
    } as never);
    mockQueryOne.mockResolvedValueOnce(null as never);

    const res = await handler(
      makeInviteRequest({
        email: 'new-owner@example.com',
        invite_type: 'platform_access',
      }, 'https://flash-mdm.bayton.org'),
      {} as never
    );

    expect(res.status).toBe(201);
    expect(mockInviteEmail).toHaveBeenCalledWith(
      'https://flash-mdm.bayton.org/invite/invite_token',
      'Flash MDM platform',
      'Super Admin'
    );
  });

  it('allows a scoped environment admin invite without workspace-wide access', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_env_admin',
      user: {
        id: 'user_env_admin',
        email: 'env-admin@example.com',
        first_name: 'Env',
        last_name: 'Admin',
        is_superadmin: false,
      },
    } as never);
    mockQueryOne
      .mockResolvedValueOnce(null as never) // existing member
      .mockResolvedValueOnce(null as never) // existing invite
      .mockResolvedValueOnce({ name: 'Workspace A' } as never); // workspace name
    // env validation query returns exact IDs
    mockQuery.mockResolvedValueOnce([{ id: 'env_1' }] as never);

    const res = await handler(
      makeInviteRequest({
        workspace_id: 'ws_1',
        email: 'person@example.com',
        role: 'member',
        environment_ids: ['env_1'],
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ message: 'Invite sent' });
    expect(mockRequireWorkspaceRole).not.toHaveBeenCalled();
    expect(mockGetEnvironmentRoleForAuth).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'user_env_admin' }) }),
      'env_1'
    );
    expect(writeInviteOffer).toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('allows scoped owner invites when inviter is owner in the target environment', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_env_owner',
      user: {
        id: 'user_env_owner',
        email: 'env-owner@example.com',
        first_name: 'Env',
        last_name: 'Owner',
        is_superadmin: false,
      },
    } as never);
    mockGetEnvironmentRoleForAuth.mockResolvedValueOnce('owner' as never);
    mockQueryOne
      .mockResolvedValueOnce(null as never) // existing member
      .mockResolvedValueOnce(null as never) // existing invite
      .mockResolvedValueOnce({ name: 'Workspace A' } as never); // workspace name
    mockQuery.mockResolvedValueOnce([{ id: 'env_1' }] as never);

    const res = await handler(
      makeInviteRequest({
        workspace_id: 'ws_1',
        email: 'owner-invitee@example.com',
        role: 'owner',
        environment_ids: ['env_1'],
      }),
      {} as never
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ message: 'Invite sent' });
    expect(writeInviteOffer).toHaveBeenCalledWith(expect.objectContaining({email:'owner-invitee@example.com',role:'owner'}));
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('rejects scoped owner invites when inviter is only admin in the target environment', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_env_admin',
      user: {
        id: 'user_env_admin',
        email: 'env-admin@example.com',
        first_name: 'Env',
        last_name: 'Admin',
        is_superadmin: false,
      },
    } as never);
    mockGetEnvironmentRoleForAuth.mockResolvedValueOnce('admin' as never);
    mockQuery.mockResolvedValueOnce([{ id: 'env_1' }] as never);

    const res = await handler(
      makeInviteRequest({
        workspace_id: 'ws_1',
        email: 'owner-invitee@example.com',
        role: 'owner',
        environment_ids: ['env_1'],
      }),
      {} as never
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Forbidden: cannot grant a role higher than your access in one or more environments',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('delegates canonical scope persistence to the transactional offer writer', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_admin',
      user: {
        id: 'user_admin',
        email: 'admin@example.com',
        first_name: 'Admin',
        last_name: 'User',
      },
    } as never);

    mockQueryOne
      .mockResolvedValueOnce(null as never) // existing member
      .mockResolvedValueOnce(null as never) // existing invite
      .mockResolvedValueOnce({ name: 'Workspace A' } as never); // workspace name

    mockExecute
      .mockRejectedValueOnce(new Error('column "environment_ids" of relation "user_invites" does not exist'))
      .mockResolvedValueOnce(undefined as never);

    const res = await handler(
      makeInviteRequest({
        workspace_id: 'ws_1',
        email: 'person@example.com',
        role: 'member',
      }),
      {} as never
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({ message: 'Invite sent' });
    expect(writeInviteOffer).toHaveBeenCalledWith(expect.objectContaining({environmentIds:[],groupIds:[]}));
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });

  it('blocks accepting an invite when signed-in email does not match invite email', async () => {
    vi.mocked(applyInviteOffer).mockRejectedValueOnce(new Response(JSON.stringify({ error: 'Invite email does not match the signed-in account' }), { status: 403 }));
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_1',
      user: { id: 'user_1', email: 'signed-in@example.com' },
    } as never);
    mockQueryOne.mockResolvedValueOnce({
      id: 'invite_1',
      email: 'other@example.com',
      role: 'member',
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      workspace_id: 'ws_1',
      environment_ids: '[]',
      group_ids: '[]',
    } as never);

    const res = await handler(makeAcceptRequest('token123'), {} as never);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'Invite email does not match the signed-in account',
    });
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it('accepts invite into the authenticated account and never creates a new user', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_2',
      user: { id: 'user_auth', email: 'member@example.com' },
    } as never);
    mockQueryOne.mockResolvedValueOnce({
      id: 'invite_2',
      email: 'member@example.com',
      role: 'member',
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      workspace_id: 'ws_2',
      environment_ids: JSON.stringify(['env_1']),
      group_ids: JSON.stringify(['group_1']),
    } as never);

    const res = await handler(makeAcceptRequest('token456'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ message: 'Invite accepted' });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(applyInviteOffer).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'user_auth', 'member@example.com');
    expect(mockLogAudit).toHaveBeenCalledOnce();
  });

  it('accepts workspace-less platform invite without adding workspace memberships', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_platform',
      user: { id: 'user_platform', email: 'msp@example.com' },
    } as never);
    mockQueryOne.mockResolvedValueOnce({
      id: 'invite_platform_1',
      email: 'msp@example.com',
      role: 'owner',
      permissions: { invite_type: 'platform_access' },
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      workspace_id: null,
      environment_ids: '[]',
      group_ids: '[]',
    } as never);

    const res = await handler(makeAcceptRequest('platformToken'), {} as never);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ message: 'Invite accepted' });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(applyInviteOffer).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'user_platform', 'msp@example.com');
  });

  it('returns a scoped-offer validation error without masking its status', async () => {
    mockRequireAuth.mockResolvedValue({
      authType: 'session',
      sessionId: 'sess_3',
      user: { id: 'user_auth', email: 'member@example.com' },
    } as never);
    mockQueryOne.mockResolvedValueOnce({
      id: 'invite_3',
      email: 'member@example.com',
      role: 'member',
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      workspace_id: 'ws_3',
      environment_ids: JSON.stringify(['env_1']),
      group_ids: '[]',
    } as never);
    vi.mocked(applyInviteOffer).mockRejectedValueOnce(new Response(JSON.stringify({
      error: 'Database migration required: workspace_memberships.access_scope is missing. Run migrations first.',
    }), { status: 500 }));

    const res = await handler(makeAcceptRequest('token789'), {} as never);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Database migration required: workspace_memberships.access_scope is missing. Run migrations first.',
    });
  });
});
