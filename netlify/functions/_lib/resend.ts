import { BRAND } from './brand.js';
import { escapeHtml } from './html.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY environment variable is required');

  const from = options.from ?? process.env.RESEND_FROM_EMAIL ?? BRAND.emailFrom;

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send email: ${error}`);
  }
}

export function magicLinkEmail(url: string): { subject: string; html: string } {
  const safeUrl = escapeHtml(url);
  return {
    subject: `Sign in to ${BRAND.name}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #111; margin-bottom: 24px;">Sign in to ${BRAND.name}</h2>
        <p style="color: #555; line-height: 1.6;">Click the button below to sign in. This link expires in 15 minutes.</p>
        <a href="${safeUrl}" style="display: inline-block; background: #111; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; margin: 24px 0;">Sign in</a>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };
}

export function signinVerificationEmail(code: string): { subject: string; html: string } {
  const safeCode = escapeHtml(code);
  return {
    subject: `${code} is your verification code`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #111; margin-bottom: 24px;">Work profile setup</h2>
        <p style="color: #555; line-height: 1.6;">Enter this code on your device to continue setting up your work profile:</p>
        <div style="text-align: center; margin: 32px 0;">
          <span style="font-size: 36px; letter-spacing: 8px; font-weight: bold; color: #111; background: #f5f5f5; padding: 16px 24px; border-radius: 8px; display: inline-block;">${safeCode}</span>
        </div>
        <p style="color: #555; line-height: 1.6;">This code expires in 10 minutes.</p>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  };
}

export function inviteEmail(url: string, workspaceName: string, inviterName: string): { subject: string; html: string } {
  const safeUrl = escapeHtml(url);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeInviterName = escapeHtml(inviterName);
  return {
    subject: `You've been invited to ${workspaceName} on ${BRAND.name}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #111; margin-bottom: 24px;">You're invited!</h2>
        <p style="color: #555; line-height: 1.6;">${safeInviterName} has invited you to join <strong>${safeWorkspaceName}</strong> on ${BRAND.name}.</p>
        <a href="${safeUrl}" style="display: inline-block; background: #111; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 500; margin: 24px 0;">Accept Invite</a>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">This invite expires in 7 days.</p>
      </div>
    `,
  };
}
