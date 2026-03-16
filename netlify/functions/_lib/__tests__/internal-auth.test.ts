import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireInternalCaller } from '../internal-auth.js';

describe('requireInternalCaller', () => {
  const originalSecret = process.env.INTERNAL_FUNCTION_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNetlifyDev = process.env.NETLIFY_DEV;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INTERNAL_FUNCTION_SECRET;
    } else {
      process.env.INTERNAL_FUNCTION_SECRET = originalSecret;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalNetlifyDev === undefined) {
      delete process.env.NETLIFY_DEV;
    } else {
      process.env.NETLIFY_DEV = originalNetlifyDev;
    }
    vi.restoreAllMocks();
  });

  it('allows localhost requests when INTERNAL_FUNCTION_SECRET is not configured', () => {
    delete process.env.INTERNAL_FUNCTION_SECRET;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => requireInternalCaller(new Request('http://localhost'))).not.toThrow();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('allows IPv6 localhost requests when INTERNAL_FUNCTION_SECRET is not configured', () => {
    delete process.env.INTERNAL_FUNCTION_SECRET;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => requireInternalCaller(new Request('http://[::1]'))).not.toThrow();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('rejects non-local requests when INTERNAL_FUNCTION_SECRET is not configured in production', () => {
    delete process.env.INTERNAL_FUNCTION_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.NETLIFY_DEV;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      requireInternalCaller(new Request('https://functions.example.com'));
      throw new Error('Expected requireInternalCaller to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const response = err as Response;
      expect(response.status).toBe(401);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('rejects requests without the correct header when secret is configured', () => {
    process.env.INTERNAL_FUNCTION_SECRET = 'super-secret';

    expect(() => requireInternalCaller(new Request('http://localhost'))).toThrow(Response);
    expect(() =>
      requireInternalCaller(new Request('http://localhost', { headers: { 'x-internal-secret': 'wrong' } }))
    ).toThrow(Response);
  });

  it('accepts requests with the correct internal secret', () => {
    process.env.INTERNAL_FUNCTION_SECRET = 'super-secret';

    expect(() =>
      requireInternalCaller(
        new Request('http://localhost', { headers: { 'x-internal-secret': 'super-secret' } })
      )
    ).not.toThrow();
  });

  it('rejects different-length secrets without throwing from timingSafeEqual', () => {
    process.env.INTERNAL_FUNCTION_SECRET = 'super-secret';

    expect(() =>
      requireInternalCaller(new Request('http://localhost', { headers: { 'x-internal-secret': 's' } }))
    ).toThrow(Response);
  });
});
