import { validateResolvedWebhookUrlForOutbound } from './webhook-ssrf.js';
import { tracedFetch } from './operational-trace.js';

interface ExecuteValidatedOutboundWebhookInput {
  url: unknown;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

// Even a hostname can be a capability. Without a trusted display-only alias,
// workflow identity and HTTP status are the safe diagnostic context.
export function safeWebhookDestination(): string {
  return '[redacted]';
}

export function safeWebhookDeliveryError(error: unknown): string {
  return error instanceof Error && error.name === 'AbortError'
    ? 'Webhook delivery timed out'
    : 'Webhook delivery failed';
}

export async function executeValidatedOutboundWebhook(
  input: ExecuteValidatedOutboundWebhookInput
): Promise<Response> {
  let validation: Awaited<ReturnType<typeof validateResolvedWebhookUrlForOutbound>>;
  try {
    validation = await validateResolvedWebhookUrlForOutbound(input.url);
  } catch (error) {
    throw new Error(safeWebhookDeliveryError(error));
  }
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(input.timeoutMs) ? Math.max(1, Number(input.timeoutMs)) : 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await tracedFetch('webhook', 'send', validation.url, {
      method: input.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.headers ?? {}),
      },
      body: JSON.stringify(input.body ?? {}),
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (error) {
    // Fetch/DNS/redirect errors can echo the full URL or credentials in a cause.
    throw new Error(safeWebhookDeliveryError(error));
  } finally {
    clearTimeout(timeout);
  }
}
