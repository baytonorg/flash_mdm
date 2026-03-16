import { describe, expect, it } from 'vitest';

import { inviteEmail, magicLinkEmail, signinVerificationEmail } from '../resend.js';

describe('email templates escape interpolated HTML', () => {
  it('escapes invite email user-controlled names while keeping template markup', () => {
    const { html } = inviteEmail(
      'https://example.com/invite?next=%22%3E<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'Alice </p><script>alert(1)</script>'
    );

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Alice &lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('<strong>');
    expect(html).toContain('href="https://example.com/invite?next=%22%3E&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  it('escapes verification code content in html body', () => {
    const { html } = signinVerificationEmail('12<svg/onload=alert(1)>');

    expect(html).toContain('12&lt;svg/onload=alert(1)&gt;');
    expect(html).not.toContain('<svg/onload=alert(1)>');
  });

  it('escapes magic link url in href attribute', () => {
    const { html } = magicLinkEmail('https://example.com/" onclick="alert(1)');

    expect(html).toContain('href="https://example.com/&quot; onclick=&quot;alert(1)"');
    expect(html).not.toContain('href="https://example.com/" onclick="alert(1)"');
  });
});
