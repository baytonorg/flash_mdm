import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { generateToken, hashToken } from './_lib/crypto.js';
import { sendEmail, magicLinkEmail } from './_lib/resend.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp, isValidEmail } from './_lib/helpers.js';
import { consumeToken } from './_lib/rate-limiter.js';

interface MagicLinkBody {
  email: string;
  redirect_path?: string;
}

export default async (request: Request, context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const body = await parseJsonBody<MagicLinkBody>(request);
  const email = body.email?.toLowerCase().trim();
  const redirectPath = sanitizeRedirectPath(body.redirect_path);

  if (!process.env.RESEND_API_KEY) {
    return errorResponse('Email delivery is not configured. Set the RESEND_API_KEY environment variable.', 503);
  }

  if (!email) {
    return errorResponse('Email is required');
  }
  if (!isValidEmail(email)) {
    return errorResponse('Please enter a valid email address');
  }

  // Rate limit by IP: 10 requests per hour
  const ip = getClientIp(request);
  const ipLimit = await consumeToken(`auth:magic:ip:${ip}`, 1, 10, 10 / 3600);
  if (!ipLimit.allowed) {
    return errorResponse('Too many requests. Please try again later.', 429);
  }

  // Check if user exists
  const user = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  // Always return success to prevent email enumeration
  if (!user) {
    return jsonResponse({ message: 'If an account exists, a magic link has been sent.' });
  }

  // Generate token
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store magic link
  await execute(
    `INSERT INTO magic_links (token_hash, email, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash, email, expiresAt]
  );

  // Build URL
  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://localhost:8888';
  const magicUrl = `${baseUrl}/api/auth/magic-link-verify?token=${token}${
    redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ''
  }`;

  // Send email
  const { subject, html } = magicLinkEmail(magicUrl);
  await sendEmail({ to: email, subject, html });

  await logAudit({
    user_id: user.id,
    action: 'auth.magic_link_sent',
    ip_address: getClientIp(request),
  });

  return jsonResponse({ message: 'If an account exists, a magic link has been sent.' });
};

function sanitizeRedirectPath(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}
