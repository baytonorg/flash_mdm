import type { Context } from '@netlify/functions';
import { queryOne } from './_lib/db.js';
import { requireSessionAuth, type SessionUser } from './_lib/auth.js';
import { logAudit } from './_lib/audit.js';
import { errorResponse, getClientIp, isValidEmail, jsonResponse, parseJsonBody } from './_lib/helpers.js';

interface ProfileBody {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
}

function optionalName(value: unknown, field: string): string | null | Response {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return errorResponse(`${field} must be a string`);
  const normalized = value.trim();
  if (normalized.length > 100) return errorResponse(`${field} must be 100 characters or fewer`);
  return normalized || null;
}

export default async (request: Request, _context: Context) => {
  if (request.method !== 'PUT') return errorResponse('Method not allowed', 405);

  try {
    const auth = await requireSessionAuth(request);
    const body = await parseJsonBody<ProfileBody>(request);
    const firstName = optionalName(body.first_name, 'first_name');
    if (firstName instanceof Response) return firstName;
    const lastName = optionalName(body.last_name, 'last_name');
    if (lastName instanceof Response) return lastName;
    if (typeof body.email !== 'string' || !isValidEmail(body.email) || body.email.trim().length > 255) {
      return errorResponse('A valid email address is required');
    }
    const email = body.email.trim().toLowerCase();

    const updated = await queryOne<Pick<SessionUser, 'id' | 'email' | 'first_name' | 'last_name' | 'is_superadmin' | 'totp_enabled'>>(
      `UPDATE users
       SET first_name = $2, last_name = $3, email = $4, updated_at = now()
       WHERE id = $1
       RETURNING id, email, first_name, last_name, is_superadmin, COALESCE(totp_enabled, false) AS totp_enabled`,
      [auth.user.id, firstName, lastName, email]
    );
    if (!updated) return errorResponse('User not found', 404);

    await logAudit({
      workspace_id: auth.user.workspace_id ?? undefined,
      user_id: auth.user.id,
      action: 'auth.profile_updated',
      resource_type: 'user',
      resource_id: auth.user.id,
      details: {
        changed_fields: ['first_name', 'last_name', 'email'],
      },
      ip_address: getClientIp(request),
    });

    return jsonResponse({
      user: {
        ...auth.user,
        ...updated,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505') {
      return errorResponse('That email address is already in use', 409);
    }
    console.error('Profile update failed', err);
    return errorResponse('Internal server error', 500);
  }
};
