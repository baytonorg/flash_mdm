import { describe, expect, it } from 'vitest';
import { normalizePostgresConnectionString } from '../postgres-connection.js';

describe('normalizePostgresConnectionString', () => {
  it('rewrites sslmode=require to verify-full', () => {
    const result = normalizePostgresConnectionString(
      'postgres://user:pass@db.example.com/app?sslmode=require'
    );
    expect(result).toBe('postgres://user:pass@db.example.com/app?sslmode=verify-full');
  });

  it('rewrites sslmode=prefer to verify-full', () => {
    const result = normalizePostgresConnectionString(
      'postgres://user:pass@db.example.com/app?sslmode=prefer'
    );
    expect(result).toContain('sslmode=verify-full');
  });

  it('preserves connection string when uselibpqcompat=true is set', () => {
    const input = 'postgres://user:pass@db.example.com/app?uselibpqcompat=true&sslmode=require';
    expect(normalizePostgresConnectionString(input)).toBe(input);
  });

  it('preserves stronger or explicit ssl modes', () => {
    const input = 'postgres://user:pass@db.example.com/app?sslmode=verify-full';
    expect(normalizePostgresConnectionString(input)).toBe(input);
  });

  it('returns original string if URL parsing fails', () => {
    const input = 'not a url';
    expect(normalizePostgresConnectionString(input)).toBe(input);
  });
});

