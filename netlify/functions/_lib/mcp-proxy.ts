/**
 * Shared MCP proxy utilities for proxying JSON-RPC requests to AMAPI MCP.
 * Adapted from MCP-POC proxy.js, simplified for Flash's auth model.
 */

import { sleep } from "./helpers.js";

const MCP_ENDPOINT = "https://androidmanagement.googleapis.com/mcp";

const MCP_RATE_LIMIT_WINDOW_MS = 60_000;
const MCP_RATE_LIMIT_MAX_CALLS = 60;
const MCP_RATE_LIMIT_PACE_MS = Math.ceil(
  MCP_RATE_LIMIT_WINDOW_MS / MCP_RATE_LIMIT_MAX_CALLS,
);

const MCP_FETCH_TIMEOUT_MS = 30_000;
const RATE_LIMIT_MAX_WAIT_MS = 30_000;
const RATE_LIMIT_MAX_KEYS = 500;

// Per-key sliding-window rate limiting (adapted from MCP-POC)
// Note: best-effort in serverless — each cold start has fresh state.
const rateLimitTimestamps = new Map<string, number[]>();
const nextAllowedAt = new Map<string, number>();

export interface McpProxyRequest {
  body: string;
  accessToken: string;
  projectId: string;
  incomingSessionId?: string;
}

export interface McpProxyResponse {
  status: number;
  body: string;
  sessionId?: string;
}

/**
 * Validate a JSON-RPC request body. Returns the parsed object or throws.
 */
export function validateJsonRpcBody(body: string): {
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON body");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON-RPC body must be an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.method !== "string" || !obj.method) {
    throw new Error('JSON-RPC body must include a "method" string');
  }

  return {
    method: obj.method,
    params: obj.params as Record<string, unknown> | undefined,
    id: obj.id as string | number | undefined,
  };
}

/**
 * Derive a rate-limit key from the JSON-RPC body.
 */
function deriveRateLimitKey(projectId: string, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const rpcMethod = String(parsed?.method || "").toLowerCase();
    if (rpcMethod === "tools/call") {
      const toolName = String(parsed?.params?.name || "unknown").toLowerCase();
      return `${projectId}:tool:${toolName}`;
    }
    return `${projectId}:rpc:${rpcMethod || "unknown"}`;
  } catch {
    return `${projectId}:unknown`;
  }
}

/**
 * Acquire a rate-limit slot (sliding window + pacing).
 */
async function acquireRateLimitSlot(key: string): Promise<number> {
  let totalWaitMs = 0;

  // Pacing: wait if too soon since last request for this key
  const now1 = Date.now();
  const nextAt = nextAllowedAt.get(key) ?? 0;
  if (now1 < nextAt) {
    const waitMs = nextAt - now1;
    totalWaitMs += waitMs;
    await sleep(waitMs);
  }

  // Evict stale keys if map grows too large
  if (rateLimitTimestamps.size > RATE_LIMIT_MAX_KEYS) {
    const cutoff = Date.now() - MCP_RATE_LIMIT_WINDOW_MS;
    for (const [k, ts] of rateLimitTimestamps) {
      if (ts.length === 0 || ts[ts.length - 1] < cutoff) {
        rateLimitTimestamps.delete(k);
        nextAllowedAt.delete(k);
      }
    }
  }

  // Sliding window with max wait cap
  let iterations = 0;
  while (totalWaitMs < RATE_LIMIT_MAX_WAIT_MS) {
    iterations++;
    if (iterations > 100) {
      throw new Error("Rate limit: too many iterations waiting for slot");
    }

    const timestamps = rateLimitTimestamps.get(key) ?? [];
    const now = Date.now();

    // Prune old timestamps
    while (
      timestamps.length > 0 &&
      now - timestamps[0] >= MCP_RATE_LIMIT_WINDOW_MS
    ) {
      timestamps.shift();
    }

    if (timestamps.length < MCP_RATE_LIMIT_MAX_CALLS) {
      timestamps.push(now);
      rateLimitTimestamps.set(key, timestamps);
      nextAllowedAt.set(key, now + MCP_RATE_LIMIT_PACE_MS);
      return totalWaitMs;
    }

    // Window full — wait for oldest to expire
    const oldest = timestamps[0];
    const waitMs = Math.max(0, MCP_RATE_LIMIT_WINDOW_MS - (now - oldest) + 250);
    totalWaitMs += waitMs;
    if (totalWaitMs > RATE_LIMIT_MAX_WAIT_MS) {
      throw new Error("Rate limit: maximum wait time exceeded");
    }
    await sleep(waitMs);
  }

  throw new Error("Rate limit: maximum wait time exceeded");
}

/**
 * Proxy a JSON-RPC request to the AMAPI MCP endpoint.
 */
export async function proxyToAmapiMcp(
  req: McpProxyRequest,
): Promise<McpProxyResponse> {
  const rateLimitKey = deriveRateLimitKey(req.projectId, req.body);
  await acquireRateLimitSlot(rateLimitKey);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${req.accessToken}`,
    "Content-Type": "application/json",
    "x-goog-user-project": req.projectId,
  };

  if (req.incomingSessionId) {
    headers["mcp-session-id"] = req.incomingSessionId;
  }

  const controller1 = new AbortController();
  const timeout1 = setTimeout(() => controller1.abort(), MCP_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(MCP_ENDPOINT, {
      method: "POST",
      headers,
      body: req.body,
      redirect: "manual",
      signal: controller1.signal,
    });
  } finally {
    clearTimeout(timeout1);
  }

  // Retry once on 503
  if (response.status === 503) {
    await sleep(2000);
    const controller2 = new AbortController();
    const timeout2 = setTimeout(
      () => controller2.abort(),
      MCP_FETCH_TIMEOUT_MS,
    );
    try {
      response = await fetch(MCP_ENDPOINT, {
        method: "POST",
        headers,
        body: req.body,
        redirect: "manual",
        signal: controller2.signal,
      });
    } finally {
      clearTimeout(timeout2);
    }
  }

  const responseBody = await response.text();
  // Sanitise upstream session ID — only allow printable ASCII, max 256 chars
  const rawSessionId = response.headers.get("mcp-session-id");
  const sessionId =
    rawSessionId && /^[\x20-\x7E]{1,256}$/.test(rawSessionId.trim())
      ? rawSessionId.trim()
      : undefined;

  return {
    status: response.status,
    body: responseBody,
    sessionId,
  };
}
