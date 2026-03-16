import { useEffect, useRef, useCallback, useMemo, useState } from 'react';

interface PlayStoreIframeProps {
  token: string;
  url: string;
  onAppSelected?: (packageName: string) => void;
  onAppApproved?: (packageName: string) => void;
}

type ProductSelectEvent = { action?: string; packageName?: string };

interface GoogleIframeHandle {
  register?: (eventName: string, callback: (payload: unknown) => void, filter?: unknown) => void;
  close?: () => void;
}

interface GoogleIframesApi {
  getContext: () => {
    openChild: (options: Record<string, unknown>) => GoogleIframeHandle;
  };
  CROSS_ORIGIN_IFRAMES_FILTER?: unknown;
}

interface GoogleApiGlobal {
  load: (moduleName: string, callback: () => void) => void;
  iframes?: GoogleIframesApi;
}

declare global {
  interface Window {
    gapi?: GoogleApiGlobal;
  }
}

const GAPI_SCRIPT_ID = 'google-gapi-script';
let gapiScriptPromise: Promise<void> | null = null;

function parseJsonIfPossible(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function collectObjectCandidates(
  raw: unknown,
  depth = 0,
  seen = new Set<object>()
): Array<Record<string, unknown>> {
  if (depth > 4) return [];

  const parsed = parseJsonIfPossible(raw);
  if (!parsed || typeof parsed !== 'object') return [];
  if (seen.has(parsed)) return [];
  seen.add(parsed);

  const record = parsed as Record<string, unknown>;
  const candidates: Array<Record<string, unknown>> = [record];

  for (const key of ['data', 'payload', 'detail', 'message', 'params']) {
    if (!(key in record)) continue;
    candidates.push(...collectObjectCandidates(record[key], depth + 1, seen));
  }

  return candidates;
}

function parsePackageFromProductId(productId: string | undefined): string | undefined {
  if (!productId) return undefined;
  const [, suffix] = productId.match(/^[a-z]+:(.+)$/i) ?? [];
  return suffix;
}

function extractProductSelectEvent(raw: unknown): ProductSelectEvent | null {
  const candidates = collectObjectCandidates(raw);

  for (const candidate of candidates) {
    const eventNameRaw = typeof candidate.event === 'string'
      ? candidate.event
      : typeof candidate.eventType === 'string'
      ? candidate.eventType
      : typeof candidate.type === 'string'
      ? candidate.type
      : undefined;
    const eventName = eventNameRaw?.toLowerCase();

    const actionRaw = typeof candidate.action === 'string' ? candidate.action : undefined;
    const action = actionRaw?.toLowerCase();
    const packageName = typeof candidate.packageName === 'string'
      ? candidate.packageName
      : typeof candidate.package_name === 'string'
      ? candidate.package_name
      : undefined;
    const productId = typeof candidate.productId === 'string'
      ? candidate.productId
      : typeof candidate.product_id === 'string'
      ? candidate.product_id
      : undefined;
    const parsedPackageFromProductId = parsePackageFromProductId(productId);

    const looksLikeProductSelect =
      eventName?.includes('productselect') ||
      (!!(packageName || parsedPackageFromProductId) &&
        (!action || action === 'selected' || action === 'approved'));

    if (!looksLikeProductSelect) continue;

    return {
      action,
      packageName: packageName ?? parsedPackageFromProductId,
    };
  }

  return null;
}

function loadGapiScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Window unavailable'));
  if (window.gapi?.load) return Promise.resolve();
  if (gapiScriptPromise) return gapiScriptPromise;

  gapiScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GAPI_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google API script')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GAPI_SCRIPT_ID;
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google API script'));
    document.head.appendChild(script);
  });

  return gapiScriptPromise;
}

/**
 * Renders the managed Google Play iframe.
 * Handles postMessage events from the iframe for app selection and approval.
 *
 * See: https://developers.google.com/android/management/apps#managed_google_play_iframe
 */
export default function PlayStoreIframe({ token, url, onAppSelected, onAppApproved }: PlayStoreIframeProps) {
  const iframeContainerRef = useRef<HTMLDivElement>(null);
  const lastEventRef = useRef<{ key: string; timestamp: number } | null>(null);
  const [useFallbackIframe, setUseFallbackIframe] = useState(false);
  const expectedOrigin = useMemo(() => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }, [url]);

  const dispatchProductSelect = useCallback(
    (raw: unknown) => {
      const productSelect = extractProductSelectEvent(raw);
      if (!productSelect?.packageName) return;

      const eventKey = `${productSelect.action ?? 'selected'}:${productSelect.packageName}`;
      const now = Date.now();
      if (lastEventRef.current?.key === eventKey && now - lastEventRef.current.timestamp < 1000) {
        return;
      }
      lastEventRef.current = { key: eventKey, timestamp: now };

      if (productSelect.action === 'approved') {
        onAppApproved?.(productSelect.packageName);
        return;
      }

      // SELECT mode emits "selected". Treat missing action on onproductselect as selected too.
      if (!productSelect.action || productSelect.action === 'selected') {
        onAppSelected?.(productSelect.packageName);
      }
    },
    [onAppApproved, onAppSelected]
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!expectedOrigin || event.origin !== expectedOrigin) return;

      dispatchProductSelect(event.data);
    },
    [dispatchProductSelect, expectedOrigin]
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    if (!url || !iframeContainerRef.current) return;

    let cancelled = false;
    let child: GoogleIframeHandle | null = null;
    const container = iframeContainerRef.current;

    setUseFallbackIframe(false);
    container.innerHTML = '';

    const init = async () => {
      try {
        await loadGapiScript();
        if (cancelled) return;

        const gapi = window.gapi;
        if (!gapi?.load) throw new Error('Google API unavailable');

        await new Promise<void>((resolve, reject) => {
          gapi.load('gapi.iframes', () => {
            if (window.gapi?.iframes?.getContext) {
              resolve();
            } else {
              reject(new Error('gapi.iframes unavailable'));
            }
          });
        });
        if (cancelled) return;

        const iframesApi = window.gapi?.iframes;
        if (!iframesApi?.getContext) throw new Error('gapi.iframes unavailable');

        child = iframesApi.getContext().openChild({
          url,
          where: container,
          attributes: {
            style: 'width:100%;height:600px;border:0;display:block;',
          },
        });
        child.register?.(
          'onproductselect',
          (payload: unknown) => dispatchProductSelect(payload),
          iframesApi.CROSS_ORIGIN_IFRAMES_FILTER
        );
      } catch {
        if (!cancelled) {
          setUseFallbackIframe(true);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      child?.close?.();
      container.innerHTML = '';
    };
  }, [dispatchProductSelect, url]);

  if (!token || !url) {
    return (
      <div className="border border-gray-200 rounded-lg bg-gray-50 p-8 text-center">
        <p className="text-sm text-gray-500">
          No web token available. Generate a token to access managed Google Play.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {useFallbackIframe ? (
        <iframe
          src={url}
          className="w-full border-0"
          style={{ height: '600px' }}
          allow="encrypted-media"
          title="Managed Google Play"
        />
      ) : (
        <div
          ref={iframeContainerRef}
          className="w-full"
          style={{ minHeight: '600px' }}
        />
      )}
    </div>
  );
}
