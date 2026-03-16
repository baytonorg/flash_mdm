import type { Context } from '@netlify/functions';
import { queryOne, execute } from './_lib/db.js';
import { generateToken, hashToken } from './_lib/crypto.js';
import { sendEmail } from './_lib/resend.js';
import { consumeToken } from './_lib/rate-limiter.js';
import { logAudit } from './_lib/audit.js';
import { jsonResponse, errorResponse, parseJsonBody, getClientIp } from './_lib/helpers.js';
import { BRAND } from './_lib/brand.js';
import { escapeHtml } from './_lib/html.js';

interface PasswordResetStartBody {
  email: string;
}

function passwordResetEmail(url: string): { subject: string; html: string } {
  const safeUrl = escapeHtml(url);
  return {
    subject: `Reset your ${BRAND.name} password`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #111; margin-bottom: 24px;">Reset your password</h2>
        <p style="color: #555; line-height: 1.6;">Click the button below to reset your password. This link expires in 15 minutes.</p>
        <a href="${safeUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:500;margin:24px 0;">Reset Password</a>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  };
}

export default async (request: Request, _context: Context) => {
  if (request.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const body = await parseJsonBody<PasswordResetStartBody>(request);
  const email = body.email?.toLowerCase().trim();
  if (!email) return errorResponse('Email is required');

  const ip = getClientIp(request);
  const ipLimit = await consumeToken(`auth:password-reset:ip:${ip}`, 1, 5, 5 / 3600);
  if (!ipLimit.allowed) {
    return errorResponse('Too many requests. Please try again later.', 429);
  }

  const user = await queryOne<{ id: string; password_hash: string | null }>(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email]
  );

  // Generic response to prevent enumeration
  if (!user) {
    return jsonResponse({ message: 'If an account exists, a password reset link has been sent.' });
  }

  const token = generateToken();
  await execute(
    'INSERT INTO magic_links (token_hash, email, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), `password_reset:${user.id}`, new Date(Date.now() + 15 * 60 * 1000)]
  );

  const baseUrl = process.env.URL ?? process.env.DEPLOY_PRIME_URL ?? 'http://localhost:8888';
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const { subject, html } = passwordResetEmail(resetUrl);
  await sendEmail({ to: email, subject, html });

  await logAudit({
    user_id: user.id,
    action: 'auth.password_reset_requested',
    ip_address: ip,
  });

  return jsonResponse({ message: 'If an account exists, a password reset link has been sent.' });
};
