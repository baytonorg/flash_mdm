import { validateResolvedWebhookUrlForOutbound } from './webhook-ssrf.js';

interface ExecuteValidatedOutboundWebhookInput {
  url: unknown;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function executeValidatedOutboundWebhook(
  input: ExecuteValidatedOutboundWebhookInput
): Promise<Response> {
  const validation = await validateResolvedWebhookUrlForOutbound(input.url);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(input.timeoutMs) ? Math.max(1, Number(input.timeoutMs)) : 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(validation.url, {
      method: input.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.headers ?? {}),
      },
      body: JSON.stringify(input.body ?? {}),
      signal: controller.signal,
      redirect: 'error',
    });
  } finally {
    clearTimeout(timeout);
  }
}
