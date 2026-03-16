export function sanitizeInAppRedirect(
  value: string | null | undefined,
  fallback = '/',
): string {
  if (!value) return fallback;

  const trimmed = value.trim();
  if (!trimmed) return fallback;

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
      return fallback;
    }
    return trimmed;
  }

  try {
    const baseOrigin = window.location.origin;
    const url = new URL(trimmed, baseOrigin);
    if (url.origin !== baseOrigin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function redirectBrowserToInApp(value: string | null | undefined, fallback = '/') {
  window.location.assign(sanitizeInAppRedirect(value, fallback));
}
