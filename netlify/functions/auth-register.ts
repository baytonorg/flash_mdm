import { applyInviteOffer } from './_lib/invite-membership.js';
import { withSignupLinkReferenceLock } from './_lib/signup-link-reference-lock.js';
import { lockMembershipWorkspaces } from './_lib/membership-lifecycle.js';
import type { Context } from '@netlify/functions';
import { queryOne, transaction } from './_lib/db.js';
import { generateToken, hashToken } from './_lib/crypto.js';
import { sendEmail, magicLinkEmail } from './_lib/resend.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { randomUUID, timingSafeEqual } from 'crypto';
import { hashPassword } from './auth-login.js';
import { consumeToken } from './_lib/rate-limiter.js';
import { getPlatformSettings } from './_lib/platform-settings.js';
import { setSessionCookie, SESSION_MAX_AGE_MILLISECONDS } from './_lib/auth.js';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from './_lib/password-policy.js';
import { getInviteTypeFromPermissions as getInviteTypeFromPermissionsShared } from './workspace-invite.js';
import { storeSigninLink } from './_lib/signin-link.js';

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
  if (isInviteRedirect && signupLinkToken) return errorResponse('Use one invitation or signup link per registration');

  if (!process.env.RESEND_API_KEY) {
    return errorResponse('Email delivery is not configured. Set the RESEND_API_KEY environment variable before allowing registrations.', 503);
  }

  if (!email || !first_name || !last_name) {
    return errorResponse('Email, first name, and last name are required');
  }

  function validateRegistrationPassword() {
    if (!password) return errorResponse('Password is required');
    if (password.length < MIN_PASSWORD_LENGTH) return errorResponse(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (password.length > MAX_PASSWORD_LENGTH) return errorResponse(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
    return null;
  }
  if (!signupLinkToken && !isInviteRedirect) {
    const invalid = validateRegistrationPassword();
    if (invalid) return invalid;
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
  const inviteTokenHash = isInviteRedirect ? hashToken(redirectPath!.slice('/invite/'.length).split('/')[0]) : null;
  if (!isFirstUser && inviteTokenHash) {
    pendingInvite = await queryOne(`SELECT id, permissions FROM user_invites
      WHERE token_hash = $1 AND lower(email) = $2 AND status = 'pending' AND expires_at > now()`, [inviteTokenHash, email]);
    if (!pendingInvite) return errorResponse('Invitation is invalid or no longer available', 403);
  }
  const pendingInviteType = getInviteTypeFromPermissionsShared(pendingInvite?.permissions);
  const isWorkspaceInviteOnboardingRegistration = !!pendingInvite && pendingInviteType === 'workspace_access';
  const isPlatformInvite = !!pendingInvite && pendingInviteType === 'platform_access';
  if (isInviteRedirect && !isPlatformInvite) {
    const invalid = validateRegistrationPassword();
    if (invalid) return invalid;
  }

  // Resolve signup link if provided
  let resolvedSignupLink: ResolvedSignupLink | null = null;
  let resolvedBySlug = false;
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
      resolvedBySlug = true;
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
  const existing = await queryOne<{id: string}>('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) {
    // Burn comparable password-hash work before returning to reduce timing-based enumeration.
    void hashPassword(password ?? '__signup_link_passwordless_register__');
    if (signupLinkToken) {
      await issueMagicLink(existing.id, email, redirectPath);
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

  const passwordHash = password && !signupLinkToken && !isPlatformInvite ? hashPassword(password) : null;

  // Create everything in a transaction
  const createAccount = () => transaction(async (client) => {
    // Re-check first-user status inside the transaction with an advisory lock
    // to prevent race conditions where two concurrent registrations both see count=0
    await client.query('SELECT pg_advisory_xact_lock(42)');
    const recheck = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM users');
    const confirmedFirstUser = parseInt(recheck.rows[0]?.count ?? '0', 10) === 0;
    if (isFirstUser !== confirmedFirstUser) throw errorResponse('Registration state changed. Please retry.', 409);
    if (resolvedSignupLink) {
      const current = (await client.query(`SELECT * FROM signup_links WHERE id = $1 AND enabled = true AND ${resolvedBySlug ? 'slug' : 'token_hash'} = $2 FOR SHARE`, [resolvedSignupLink.id, resolvedBySlug ? signupLinkToken!.toLowerCase() : hashToken(signupLinkToken!)])).rows[0];
      if (!current || Object.entries(resolvedSignupLink).some(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))) throw errorResponse('Signup link changed. Reload the link and try again.', 409);
      const scope = current.scope_type === 'workspace' ? current.scope_id : (await client.query('SELECT workspace_id FROM environments WHERE id = $1', [current.scope_id])).rows[0]?.workspace_id;
      if (!scope) throw errorResponse('Signup scope no longer exists', 409);
      await lockMembershipWorkspaces(client, [scope]);
    }

    // Create user
    const userId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, is_superadmin)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, email, passwordHash, first_name, last_name, confirmedFirstUser]
    );

    if (pendingInvite && inviteTokenHash) {
      const applied = await applyInviteOffer(client, inviteTokenHash, userId, email);
      if (applied.alreadyAccepted) throw errorResponse('Invitation has already been used', 409);
    }
    if (isWorkspaceInviteOnboardingRegistration) {
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
            invite_auto_accepted: true,
          }),
          getClientIp(request),
        ]
      );
      const sessionToken = generateToken();
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MILLISECONDS);
      await client.query(`INSERT INTO sessions (token_hash, user_id, workspace_id, ip_address, user_agent, expires_at)
        SELECT $1, $2, wm.workspace_id, $3, $4, $5 FROM workspace_memberships wm
        JOIN user_invites i ON i.workspace_id = wm.workspace_id WHERE wm.user_id = $2 AND i.id = $6`,
        [hashToken(sessionToken), userId, ip, request.headers.get('user-agent'), expiresAt, pendingInvite!.id]);
      await client.query('UPDATE users SET last_login_at = now(), last_login_ip = $1, last_login_method = $2 WHERE id = $3',
        [ip, 'invite_registration', userId]);
      return {userId, sessionToken};
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
            `UPDATE users SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('needs_environment_setup', true, 'environment_setup_workspace_id', $2::text) WHERE id = $1`,
            [userId, resolvedSignupLink.scope_id]
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
      return {userId};
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
    return { userId };
  });

  let account;
  try {
    account = await (resolvedSignupLink ? withSignupLinkReferenceLock(createAccount) : createAccount());
    if (account.sessionToken) return jsonResponse(
      { message: 'Account created and invite accepted.', session_set: true, redirect: '/' }, 201,
      { 'Set-Cookie': setSessionCookie(account.sessionToken) });
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  // A platform invitation is already consumed with its new workspace.
  await issueMagicLink(account.userId, email, isPlatformInvite ? '/' : redirectPath);

  return jsonResponse({ message: 'Account created. Check your email to sign in.' }, 201);
};

function sanitizeRedirectPath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

async function issueMagicLink(userId: string, email: string, redirectPath: string | null): Promise<void> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  if (!await storeSigninLink(userId, email, tokenHash, new Date(Date.now() + 15 * 60 * 1000))) return;

  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://localhost:8888';
  const magicUrl = `${baseUrl}/api/auth/magic-link-verify?token=${token}${
    redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ''
  }`;
  const { subject, html } = magicLinkEmail(magicUrl);
  await sendEmail({ to: email, subject, html });
}
