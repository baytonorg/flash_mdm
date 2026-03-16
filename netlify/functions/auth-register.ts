import type { Context } from '@netlify/functions';
import { queryOne, execute, transaction } from './_lib/db.js';
import { generateToken, hashToken } from './_lib/crypto.js';
import { sendEmail, magicLinkEmail } from './_lib/resend.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { randomUUID, timingSafeEqual } from 'crypto';
import { hashPassword } from './auth-login.js';
import { consumeToken } from './_lib/rate-limiter.js';
import { getPlatformSettings } from './_lib/platform-settings.js';
import { setSessionCookie, SESSION_MAX_AGE_MILLISECONDS } from './_lib/auth.js';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from './_lib/password-policy.js';
import {
  upsertWorkspaceMembershipFromInvite,
  getInviteForAccept,
  parseJsonStringArray,
  getInviteTypeFromPermissions as getInviteTypeFromPermissionsShared,
} from './workspace-invite.js';

interface RegisterBody {
  email: string;
  password?: string;
  first_name: string;
  last_name: string;
  workspace_name?: string;
  redirect_path?: string;
  signup_link_token?: string;
}

interface ResolvedSignupLink {
  id: string;
  scope_type: 'workspace' | 'environment';
  scope_id: string;
  default_role: string;
  default_access_scope: string;
  auto_assign_environment_ids: string[];
  auto_assign_group_ids: string[];
  allow_environment_creation: boolean;
  allowed_domains: string[];
}

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const body = await parseJsonBody<RegisterBody>(request);
  const { email: rawEmail, password, first_name, last_name, workspace_name } = body;
  const signupLinkToken = body.signup_link_token?.trim();
  const email = rawEmail?.toLowerCase().trim();
  const workspaceName = workspace_name?.trim();
  const redirectPath = sanitizeRedirectPath(body.redirect_path);
  const isInviteRedirect = !!redirectPath && redirectPath.startsWith('/invite/');

  if (!email || !first_name || !last_name) {
    return errorResponse('Email, first name, and last name are required');
  }

  if (!signupLinkToken && !password) {
    return errorResponse('Password is required');
  }

  if (!signupLinkToken) {
    if ((password ?? '').length < MIN_PASSWORD_LENGTH) {
      return errorResponse(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    if ((password ?? '').length > MAX_PASSWORD_LENGTH) {
      return errorResponse(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
    }
  }

  // Rate limit by IP: 3 registrations per hour
  const ip = getClientIp(request);
  const ipLimit = await consumeToken(`auth:register:ip:${ip}`, 1, 3, 3 / 3600);
  if (!ipLimit.allowed) {
    return errorResponse('Too many registration attempts. Please try again later.', 429);
  }

  // Check bootstrap: is this the first user?
  const userCount = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM users', []);
  const isFirstUser = parseInt(userCount?.count ?? '0', 10) === 0;
  let pendingInvite: { id: string; permissions?: unknown } | null = null;
  if (!isFirstUser && isInviteRedirect) {
    pendingInvite = await queryOne<{ id: string; permissions?: unknown }>(
      `SELECT id, permissions FROM user_invites
       WHERE email = $1 AND status = 'pending' AND expires_at > now()
       LIMIT 1`,
      [email]
    );
  }
  const pendingInviteType = getInviteTypeFromPermissionsShared(pendingInvite?.permissions);
  const isWorkspaceInviteOnboardingRegistration = !!pendingInvite && pendingInviteType === 'workspace_access';

  // Resolve signup link if provided
  let resolvedSignupLink: ResolvedSignupLink | null = null;
  if (signupLinkToken) {
    const tokenHash = hashToken(signupLinkToken);
    resolvedSignupLink = await queryOne<ResolvedSignupLink>(
      `SELECT id, scope_type, scope_id, default_role, default_access_scope,
              auto_assign_environment_ids, auto_assign_group_ids, allow_environment_creation,
              allowed_domains
       FROM signup_links
       WHERE token_hash = $1 AND enabled = true`,
      [tokenHash]
    );
    // Also try by slug
    if (!resolvedSignupLink) {
      resolvedSignupLink = await queryOne<ResolvedSignupLink>(
        `SELECT id, scope_type, scope_id, default_role, default_access_scope,
                auto_assign_environment_ids, auto_assign_group_ids, allow_environment_creation,
                allowed_domains
         FROM signup_links
         WHERE slug = $1 AND enabled = true
         ORDER BY updated_at DESC NULLS LAST, created_at DESC
         LIMIT 1`,
        [signupLinkToken.toLowerCase()]
      );
    }
    if (!resolvedSignupLink) {
      return errorResponse('Invalid or disabled signup link', 403);
    }
    const allowedDomains = resolvedSignupLink.allowed_domains ?? [];
    if (allowedDomains.length > 0) {
      const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';
      const domainAllowed = allowedDomains.some((domain) => domain.toLowerCase() === emailDomain);
      if (!domainAllowed) {
        return errorResponse('Email domain is not allowed for this signup link', 403);
      }
    }
  }

  // Platform-level registration gate: allow bootstrap creation of the first user,
  // but block self-serve registrations when invite-only mode is enabled.
  // Signup links bypass this gate — the link IS the authorisation.
  if (!isFirstUser) {
    const platformSettings = await getPlatformSettings();
    if (platformSettings.invite_only_registration) {
      if (!pendingInvite && !resolvedSignupLink) {
        return errorResponse('Registration is disabled. Ask an admin for an invitation.', 403);
      }
    }
  }

  if (!isWorkspaceInviteOnboardingRegistration && !resolvedSignupLink && !workspaceName) {
    return errorResponse('Workspace name is required');
  }

  // Check if user already exists - return generic response to prevent enumeration
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    // Burn comparable password-hash work before returning to reduce timing-based enumeration.
    void hashPassword(password ?? '__signup_link_passwordless_register__');
    if (signupLinkToken) {
      await issueMagicLink(email, redirectPath);
    }
    return jsonResponse({ message: 'Account created. Check your email to sign in.' }, 201);
  }

  // If BOOTSTRAP_SECRET is set and this is first user, check it
  const bootstrapSecret = process.env.BOOTSTRAP_SECRET;
  if (isFirstUser && bootstrapSecret) {
    const providedSecret = request.headers.get('x-bootstrap-secret') ?? '';
    const expected = Buffer.from(bootstrapSecret, 'utf8');
    const provided = Buffer.from(providedSecret, 'utf8');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return errorResponse('Bootstrap secret required for first user registration', 403);
    }
  }

  const passwordHash = password ? hashPassword(password) : null;

  // For workspace invite registrations, resolve the full invite data before the transaction
  let fullInvite: Awaited<ReturnType<typeof getInviteForAccept>> | null = null;
  if (isWorkspaceInviteOnboardingRegistration) {
    const inviteToken = redirectPath!.split('/invite/')[1]?.split('/')[0] ?? '';
    if (inviteToken) {
      const inviteTokenHash = hashToken(inviteToken);
      fullInvite = await getInviteForAccept(inviteTokenHash);
    }
  }

  // Create everything in a transaction
  await transaction(async (client) => {
    // Re-check first-user status inside the transaction with an advisory lock
    // to prevent race conditions where two concurrent registrations both see count=0
    await client.query('SELECT pg_advisory_xact_lock(42)');
    const recheck = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM users');
    const confirmedFirstUser = parseInt(recheck.rows[0]?.count ?? '0', 10) === 0;

    // Create user
    const userId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, is_superadmin)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, passwordHash, first_name, last_name, confirmedFirstUser]
    );

    if (isWorkspaceInviteOnboardingRegistration) {
      if (fullInvite && fullInvite.status === 'pending' && fullInvite.workspace_id) {
        const envIds = parseJsonStringArray(fullInvite.environment_ids);
        const groupIds = parseJsonStringArray(fullInvite.group_ids);
        const accessScope = envIds.length > 0 || groupIds.length > 0 ? 'scoped' : 'workspace';

        // Add workspace membership
        await upsertWorkspaceMembershipFromInvite(client, {
          workspaceId: fullInvite.workspace_id,
          userId,
          role: fullInvite.role,
          accessScope: accessScope as 'workspace' | 'scoped',
        });

        // Add environment memberships
        for (const envId of envIds) {
          await client.query(
            `INSERT INTO environment_memberships (environment_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (environment_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [envId, userId, fullInvite.role]
          );
        }

        // Add group memberships
        for (const gId of groupIds) {
          await client.query(
            `INSERT INTO group_memberships (group_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (group_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
            [gId, userId, fullInvite.role]
          );
        }

        // Mark invite as accepted
        await client.query(
          `UPDATE user_invites SET status = 'accepted', accepted_at = now() WHERE id = $1`,
          [fullInvite.id]
        );
      }

      // Audit
      await client.query(
        `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          'auth.register',
          'user',
          userId,
          JSON.stringify({
            is_superadmin: confirmedFirstUser,
            invited_onboarding: true,
            invite_type: pendingInviteType,
            invite_auto_accepted: !!fullInvite,
          }),
          getClientIp(request),
        ]
      );
      return;
    }

    // Signup link registration branch
    if (resolvedSignupLink) {
      if (resolvedSignupLink.scope_type === 'workspace') {
        // Add workspace membership
        await client.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, access_scope)
           VALUES ($1, $2, $3, $4)`,
          [
            resolvedSignupLink.scope_id,
            userId,
            resolvedSignupLink.default_role,
            resolvedSignupLink.default_access_scope,
          ]
        );

        if (resolvedSignupLink.allow_environment_creation) {
          // Flag user for post-login environment setup
          await client.query(
            `UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"needs_environment_setup": true}'::jsonb WHERE id = $1`,
            [userId]
          );
        } else {
          // Auto-assign to environments
          const envIds: string[] = Array.isArray(resolvedSignupLink.auto_assign_environment_ids)
            ? resolvedSignupLink.auto_assign_environment_ids
            : [];
          for (const envId of envIds) {
            await client.query(
              `INSERT INTO environment_memberships (environment_id, user_id, role)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING`,
              [envId, userId, resolvedSignupLink.default_role]
            );
            // Add to root group of each environment
            const rootGroup = await client.query<{ id: string }>(
              `SELECT id FROM groups WHERE environment_id = $1 AND parent_group_id IS NULL ORDER BY created_at LIMIT 1`,
              [envId]
            );
            if (rootGroup.rows[0]) {
              await client.query(
                `INSERT INTO group_memberships (group_id, user_id, role, permissions)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT DO NOTHING`,
                [rootGroup.rows[0].id, userId, resolvedSignupLink.default_role,
                 JSON.stringify({ devices: true, policies: true, apps: true, reports: true, settings: false, users: false })]
              );
            }
          }
        }
      } else {
        // Environment link: look up workspace from environment
        const envRow = await client.query<{ workspace_id: string }>(
          'SELECT workspace_id FROM environments WHERE id = $1',
          [resolvedSignupLink.scope_id]
        );
        const workspaceId = envRow.rows[0]?.workspace_id;
        if (workspaceId) {
          // Add workspace membership (scoped)
          await client.query(
            `INSERT INTO workspace_memberships (workspace_id, user_id, role, access_scope)
             VALUES ($1, $2, $3, 'scoped')
             ON CONFLICT DO NOTHING`,
            [workspaceId, userId, resolvedSignupLink.default_role]
          );
        }

        // Add environment membership
        await client.query(
          `INSERT INTO environment_memberships (environment_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [resolvedSignupLink.scope_id, userId, resolvedSignupLink.default_role]
        );

        // Auto-assign to groups
        const groupIds: string[] = Array.isArray(resolvedSignupLink.auto_assign_group_ids)
          ? resolvedSignupLink.auto_assign_group_ids
          : [];
        if (groupIds.length > 0) {
          for (const groupId of groupIds) {
            await client.query(
              `INSERT INTO group_memberships (group_id, user_id, role, permissions)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING`,
              [groupId, userId, resolvedSignupLink.default_role,
               JSON.stringify({ devices: true, policies: true, apps: true, reports: true, settings: false, users: false })]
            );
          }
        } else {
          // Add to root group of the environment
          const rootGroup = await client.query<{ id: string }>(
            `SELECT id FROM groups WHERE environment_id = $1 AND parent_group_id IS NULL ORDER BY created_at LIMIT 1`,
            [resolvedSignupLink.scope_id]
          );
          if (rootGroup.rows[0]) {
            await client.query(
              `INSERT INTO group_memberships (group_id, user_id, role, permissions)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING`,
              [rootGroup.rows[0].id, userId, resolvedSignupLink.default_role,
               JSON.stringify({ devices: true, policies: true, apps: true, reports: true, settings: false, users: false })]
            );
          }
        }
      }

      // Audit
      await client.query(
        `INSERT INTO audit_log (workspace_id, user_id, action, resource_type, resource_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          resolvedSignupLink.scope_type === 'workspace' ? resolvedSignupLink.scope_id : null,
          userId,
          'auth.register',
          'user',
          userId,
          JSON.stringify({
            is_superadmin: confirmedFirstUser,
            signup_link_id: resolvedSignupLink.id,
            scope_type: resolvedSignupLink.scope_type,
            scope_id: resolvedSignupLink.scope_id,
            allow_environment_creation: resolvedSignupLink.allow_environment_creation,
          }),
          getClientIp(request),
        ]
      );
      return;
    }

    // Create workspace
    const workspaceId = randomUUID();
    await client.query(
      'INSERT INTO workspaces (id, name) VALUES ($1, $2)',
      [workspaceId, workspaceName]
    );

    // Add user as workspace owner
    await client.query(
      'INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [workspaceId, userId, 'owner']
    );

    // Create default environment
    const environmentId = randomUUID();
    await client.query(
      'INSERT INTO environments (id, workspace_id, name) VALUES ($1, $2, $3)',
      [environmentId, workspaceId, 'Default']
    );

    // Add user as environment admin
    await client.query(
      'INSERT INTO environment_memberships (environment_id, user_id, role) VALUES ($1, $2, $3)',
      [environmentId, userId, 'admin']
    );

    // Create root group
    const groupId = randomUUID();
    await client.query(
      'INSERT INTO groups (id, environment_id, name, description) VALUES ($1, $2, $3, $4)',
      [groupId, environmentId, workspaceName, 'Root group']
    );

    // Self-link in closure table
    await client.query(
      'INSERT INTO group_closures (ancestor_id, descendant_id, depth) VALUES ($1, $2, $3)',
      [groupId, groupId, 0]
    );

    // Add user to root group as admin
    await client.query(
      'INSERT INTO group_memberships (group_id, user_id, role, permissions) VALUES ($1, $2, $3, $4)',
      [groupId, userId, 'admin', JSON.stringify({ devices: true, policies: true, apps: true, reports: true, settings: true, users: true })]
    );

    // Audit
    await client.query(
      `INSERT INTO audit_log (workspace_id, environment_id, user_id, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [workspaceId, environmentId, userId, 'auth.register', 'user', userId,
       JSON.stringify({ is_superadmin: confirmedFirstUser, workspace_name: workspaceName }), getClientIp(request)]
    );
  });

  // For workspace invite onboarding: create session directly and skip magic link
  if (isWorkspaceInviteOnboardingRegistration) {
    // Look up the newly created user
    const newUser = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    if (newUser) {
      const sessionToken = generateToken();
      const sessionTokenHash = hashToken(sessionToken);
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MILLISECONDS);

      // Look up workspace membership for session
      const membership = await queryOne<{ workspace_id: string }>(
        'SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 LIMIT 1',
        [newUser.id]
      );

      await execute(
        `INSERT INTO sessions (token_hash, user_id, workspace_id, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionTokenHash, newUser.id, membership?.workspace_id ?? null, ip, request.headers.get('user-agent'), expiresAt]
      );

      // Update last login
      await execute(
        'UPDATE users SET last_login_at = now(), last_login_ip = $1, last_login_method = $2 WHERE id = $3',
        [ip, 'invite_registration', newUser.id]
      );

      return jsonResponse(
        { message: 'Account created and invite accepted.', session_set: true, redirect: '/' },
        201,
        { 'Set-Cookie': setSessionCookie(sessionToken) }
      );
    }
  }

  // Send magic link for login (self-signup and platform invites)
  await issueMagicLink(email, redirectPath);

  return jsonResponse({ message: 'Account created. Check your email to sign in.' }, 201);
};

function sanitizeRedirectPath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

async function issueMagicLink(email: string, redirectPath: string | null): Promise<void> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  await execute(
    'INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, email, new Date(Date.now() + 15 * 60 * 1000)]
  );

  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://localhost:8888';
  const magicUrl = `${baseUrl}/api/auth/magic-link-verify?token=${token}${
    redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ''
  }`;
  const { subject, html } = magicLinkEmail(magicUrl);
  await sendEmail({ to: email, subject, html });
}
