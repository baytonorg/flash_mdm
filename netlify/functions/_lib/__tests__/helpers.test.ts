import { describe, it, expect } from 'vitest';
import {
  jsonResponse,
  errorResponse,
  getClientIp,
  parseJsonBody,
  getSearchParams,
  assertSameOriginRequest,
  isValidUuid,
} from '../helpers.js';

describe('jsonResponse', () => {
  it('returns a Response with application/json content-type', async () => {
    const res = jsonResponse({ ok: true });
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('returns status 200 by default', () => {
    const res = jsonResponse({ ok: true });
    expect(res.status).toBe(200);
  });

  it('serializes the body as JSON', async () => {
    const data = { message: 'hello', count: 42 };
    const res = jsonResponse(data);
    const body = await res.json();
    expect(body).toEqual(data);
  });

  it('accepts custom status codes', () => {
    expect(jsonResponse({}, 201).status).toBe(201);
    expect(jsonResponse({}, 404).status).toBe(404);
    expect(jsonResponse({}, 500).status).toBe(500);
  });

  it('merges custom headers', () => {
    const res = jsonResponse({}, 200, { 'X-Custom': 'value' });
    expect(res.headers.get('X-Custom')).toBe('value');
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('handles null data', async () => {
    const res = jsonResponse(null);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('handles array data', async () => {
    const arr = [1, 2, 3];
    const res = jsonResponse(arr);
    const body = await res.json();
    expect(body).toEqual(arr);
  });
});

describe('errorResponse', () => {
  it('returns an object with an error field', async () => {
    const res = errorResponse('Something went wrong');
    const body = await res.json();
    expect(body).toEqual({ error: 'Something went wrong' });
  });

  it('returns status 400 by default', () => {
    const res = errorResponse('bad request');
    expect(res.status).toBe(400);
  });

  it('accepts custom status codes', () => {
    expect(errorResponse('not found', 404).status).toBe(404);
    expect(errorResponse('internal', 500).status).toBe(500);
    expect(errorResponse('unauthorized', 401).status).toBe(401);
  });

  it('has application/json content-type', () => {
    const res = errorResponse('err');
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('getClientIp', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost', { headers });
  }

  it('reads from x-forwarded-for header (first IP)', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('trims whitespace from x-forwarded-for', () => {
    const req = makeRequest({ 'x-forwarded-for': '  10.0.0.1  , 10.0.0.2' });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('falls back to x-real-ip when x-forwarded-for is missing', () => {
    const req = makeRequest({ 'x-real-ip': '9.8.7.6' });
    expect(getClientIp(req)).toBe('9.8.7.6');
  });

  it('returns "unknown" when no IP headers are present', () => {
    const req = makeRequest({});
    expect(getClientIp(req)).toBe('unknown');
  });

  it('prefers x-forwarded-for over x-real-ip', () => {
    const req = makeRequest({
      'x-forwarded-for': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
    });
    expect(getClientIp(req)).toBe('1.1.1.1');
  });

  it('handles single IP in x-forwarded-for (no comma)', () => {
    const req = makeRequest({ 'x-forwarded-for': '4.4.4.4' });
    expect(getClientIp(req)).toBe('4.4.4.4');
  });
});

describe('parseJsonBody', () => {
  it('parses valid JSON body', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await parseJsonBody<{ name: string }>(req);
    expect(data).toEqual({ name: 'test' });
  });

  it('throws a Response on invalid JSON body', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    try {
      await parseJsonBody(req);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      const res = err as Response;
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid JSON body');
    }
  });

  it('throws a Response when body is empty', async () => {
    const req = new Request('http://localhost', {
      method: 'POST',
      body: '',
      headers: { 'Content-Type': 'application/json' },
    });
    try {
      await parseJsonBody(req);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
    }
  });

  it('rejects cross-origin mutating requests', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
    });

    await expect(parseJsonBody(req)).rejects.toBeInstanceOf(Response);
    try {
      await parseJsonBody(req);
      expect.fail('should throw');
    } catch (err) {
      const res = err as Response;
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({
        error: 'Cross-origin requests are not allowed',
      });
    }
  });
});

describe('assertSameOriginRequest', () => {
  it('allows missing Origin header', () => {
    const req = new Request('http://localhost/api/test', { method: 'POST' });
    expect(() => assertSameOriginRequest(req)).not.toThrow();
  });

  it('allows matching Origin header', () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { Origin: 'http://localhost' },
    });
    expect(() => assertSameOriginRequest(req)).not.toThrow();
  });

  it('throws Response for mismatched origin', async () => {
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
    });
    try {
      assertSameOriginRequest(req);
      expect.fail('should have thrown');
    } catch (err) {
      const res = err as Response;
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({
        error: 'Cross-origin requests are not allowed',
      });
    }
  });
});

describe('getSearchParams', () => {
  it('extracts query parameters from the request URL', () => {
    const req = new Request('http://localhost/api?foo=bar&baz=123');
    const params = getSearchParams(req);
    expect(params.get('foo')).toBe('bar');
    expect(params.get('baz')).toBe('123');
  });

  it('returns empty params when none present', () => {
    const req = new Request('http://localhost/api');
    const params = getSearchParams(req);
    expect(params.toString()).toBe('');
  });

  it('handles multiple values for same key', () => {
    const req = new Request('http://localhost/api?tag=a&tag=b');
    const params = getSearchParams(req);
    expect(params.getAll('tag')).toEqual(['a', 'b']);
  });
});

describe('isValidUuid', () => {
  it('accepts valid UUIDs', () => {
    expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects malformed UUIDs', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('550e8400e29b41d4a716446655440000')).toBe(false);
    expect(isValidUuid('550e8400-e29b-61d4-a716-446655440000')).toBe(false);
  });
});
