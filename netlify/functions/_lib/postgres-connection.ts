const SSLMODE_ALIASES_TO_VERIFY_FULL = new Set(['prefer', 'require', 'verify-ca']);

export function normalizePostgresConnectionString(connectionString?: string | null): string | undefined {
  if (!connectionString) return undefined;

  try {
    const url = new URL(connectionString);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      return connectionString;
    }

    const useLibpqCompat = url.searchParams.get('uselibpqcompat');
    if (useLibpqCompat?.toLowerCase() === 'true') {
      return connectionString;
    }

    const sslmode = url.searchParams.get('sslmode');
    if (!sslmode) return connectionString;

    const normalizedSslMode = sslmode.toLowerCase();
    if (!SSLMODE_ALIASES_TO_VERIFY_FULL.has(normalizedSslMode)) {
      return connectionString;
    }

    url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  } catch {
    return connectionString;
  }
}

