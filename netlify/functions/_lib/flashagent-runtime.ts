/**
 * Flashi tool-calling runtime.
 *
 * Adapted from MCP-POC gpt-assistant.js — the OpenAI tool-calling loop.
 * Simplified: no caching layer, no async jobs (for now), no enterprise resolution.
 * Uses Flash's existing amapiCall() for AMAPI tools and direct Postgres queries for Flash internal tools.
 */

import { proxyToAmapiMcp } from "./mcp-proxy.js";
import { checkPermission, type PermissionMatrix } from "./rbac.js";
import type { AuthContext } from "./auth.js";
import { extractEnterprisePrefix } from "./enterprise-utils.js";
import { sleep } from "./helpers.js";
import { storeBlob } from "./blobs.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_TOOL_ROUNDS = Number(process.env.FLASHAGENT_MAX_TOOL_ROUNDS || 8);
const MAX_TOOL_CONTENT_CHARS = 120_000;
const OPENAI_MAX_RETRIES = 3;
const OPENAI_RETRY_BASE_MS = 450;
const OPENAI_FETCH_TIMEOUT_MS = 45_000;
const TOTAL_EXECUTION_BUDGET_MS = 5 * 60 * 1000; // 5 minutes total wall-clock budget

interface McpRpcSuccessPayload {
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: {
    message?: string;
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseMcpToolPayload(rawBody: string): unknown {
  const parsedRpc = tryParseJson(rawBody) as McpRpcSuccessPayload | null;
  if (!parsedRpc || typeof parsedRpc !== "object") {
    return rawBody;
  }

  if (parsedRpc.error) {
    const message = String(parsedRpc.error.message || "MCP RPC error");
    throw new Error(message);
  }

  const result = parsedRpc.result;
  if (result?.isError) {
    const message = String(result.content?.[0]?.text || "MCP tool execution failed");
    throw new Error(message);
  }

  const textPayload = result?.content?.[0]?.text;
  if (typeof textPayload === "string" && textPayload.trim()) {
    const parsedText = tryParseJson(textPayload);
    return parsedText ?? textPayload;
  }

  if (result && typeof result === "object") {
    return result;
  }

  return parsedRpc;
}

function toIsoTime(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNewerDevice(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aScore = Math.max(
    toIsoTime(a.enrollmentTime),
    toIsoTime(a.lastStatusReportTime),
    toIsoTime(a.lastPolicySyncTime),
  );
  const bScore = Math.max(
    toIsoTime(b.enrollmentTime),
    toIsoTime(b.lastStatusReportTime),
    toIsoTime(b.lastPolicySyncTime),
  );
  return aScore >= bScore;
}

function dedupeDevicesForReenrolment(
  devices: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byName = new Map<string, Record<string, unknown>>();

  for (const device of devices) {
    const name = String(device.name || "").trim();
    if (!name) continue;
    const existing = byName.get(name);
    if (!existing || isNewerDevice(device, existing)) {
      byName.set(name, device);
    }
  }

  for (const device of byName.values()) {
    const currentName = String(device.name || "").trim();
    const previousNames = Array.isArray(device.previousDeviceNames)
      ? (device.previousDeviceNames as unknown[])
      : [];
    for (const previousNameRaw of previousNames) {
      const previousName = String(previousNameRaw || "").trim();
      if (!previousName || previousName === currentName) continue;
      if (byName.has(previousName)) byName.delete(previousName);
    }
  }

  return Array.from(byName.values());
}

function simplifyListDevice(device: Record<string, unknown>): Record<string, unknown> {
  const hardwareInfo =
    device.hardwareInfo && typeof device.hardwareInfo === "object"
      ? (device.hardwareInfo as Record<string, unknown>)
      : {};
  const softwareInfo =
    device.softwareInfo && typeof device.softwareInfo === "object"
      ? (device.softwareInfo as Record<string, unknown>)
      : {};

  const updateStatus =
    softwareInfo.systemUpdateInfo &&
    typeof softwareInfo.systemUpdateInfo === "object"
      ? String(
          (softwareInfo.systemUpdateInfo as Record<string, unknown>).updateStatus || "",
        ).trim()
      : "";

  return {
    name: device.name || null,
    previousDeviceNames: Array.isArray(device.previousDeviceNames)
      ? device.previousDeviceNames
      : [],
    state: device.state || null,
    policyCompliant:
      typeof device.policyCompliant === "boolean" ? device.policyCompliant : null,
    enrollmentTime: device.enrollmentTime || null,
    lastStatusReportTime: device.lastStatusReportTime || null,
    lastPolicySyncTime: device.lastPolicySyncTime || null,
    model: hardwareInfo.model || null,
    manufacturer: hardwareInfo.manufacturer || null,
    serialNumber: hardwareInfo.serialNumber || null,
    androidVersion: softwareInfo.androidVersion || null,
    securityPatchLevel: softwareInfo.securityPatchLevel || null,
    updateStatus: updateStatus || null,
    policyName: device.policyName || null,
    appliedPolicyName: device.appliedPolicyName || null,
  };
}

function sanitiseToolPayloadForModel(
  toolName: string,
  payload: unknown,
): unknown {
  if (toolName !== "amapi_list_devices") return payload;
  if (!payload || typeof payload !== "object") return payload;

  const obj = payload as Record<string, unknown>;
  const rawDevices = Array.isArray(obj.devices) ? obj.devices : [];
  const typedDevices = rawDevices.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
  const dedupedDevices = dedupeDevicesForReenrolment(typedDevices);

  const previousDeviceLinkedCount = dedupedDevices.filter(
    (device) =>
      Array.isArray(device.previousDeviceNames) &&
      device.previousDeviceNames.length > 0,
  ).length;

  return {
    summary: {
      deviceCount: dedupedDevices.length,
      previousDeviceLinkedCount,
    },
    devices: dedupedDevices.map((device) => simplifyListDevice(device)),
    nextPageToken:
      typeof obj.nextPageToken === "string" && obj.nextPageToken
        ? obj.nextPageToken
        : null,
  };
}

function serializeToolPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const AMAPI_MCP_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "amapi_list_devices",
      description:
        "List devices for an enterprise. Returns device names, states, policy info.",
      parameters: {
        type: "object",
        properties: {
          enterprise_name: {
            type: "string",
            description: "Enterprise resource name (e.g. enterprises/LC...)",
          },
          page_size: {
            type: "number",
            description: "Max devices per page (default 100)",
          },
          page_token: {
            type: "string",
            description: "Pagination token for next page",
          },
        },
        required: ["enterprise_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "amapi_get_device",
      description: "Get detailed info about a specific device.",
      parameters: {
        type: "object",
        properties: {
          device_name: {
            type: "string",
            description:
              "Full device resource name (e.g. enterprises/LC.../devices/...)",
          },
        },
        required: ["device_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "amapi_list_policies",
      description: "List policies for an enterprise.",
      parameters: {
        type: "object",
        properties: {
          enterprise_name: {
            type: "string",
            description: "Enterprise resource name",
          },
          page_size: { type: "number", description: "Max policies per page" },
          page_token: { type: "string", description: "Pagination token" },
        },
        required: ["enterprise_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "amapi_get_policy",
      description: "Get detailed info about a specific policy.",
      parameters: {
        type: "object",
        properties: {
          policy_name: {
            type: "string",
            description:
              "Full policy resource name (e.g. enterprises/LC.../policies/...)",
          },
        },
        required: ["policy_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "amapi_get_application",
      description: "Get details about an application (Android app).",
      parameters: {
        type: "object",
        properties: {
          application_name: {
            type: "string",
            description:
              "Application resource name (e.g. enterprises/LC.../applications/com.example.app)",
          },
        },
        required: ["application_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "amapi_list_web_apps",
      description: "List web apps for an enterprise.",
      parameters: {
        type: "object",
        properties: {
          enterprise_name: {
            type: "string",
            description: "Enterprise resource name",
          },
          page_size: {
            type: "number",
            description: "Max web apps per page (default 100)",
          },
          page_token: {
            type: "string",
            description: "Pagination token for next page",
          },
        },
        required: ["enterprise_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "amapi_get_web_app",
      description: "Get details about a specific web app.",
      parameters: {
        type: "object",
        properties: {
          web_app_name: {
            type: "string",
            description: "Web app resource name",
          },
        },
        required: ["web_app_name"],
      },
    },
  },
];

const FLASH_INTERNAL_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "flash_api_get",
      description:
        "Call Flash REST API GET endpoints using the dedicated environment API key. Use only documented routes from the supplied OpenAPI route catalog.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute API path that starts with /api (for example /api/devices/list).",
          },
          query: {
            type: "object",
            description:
              "Optional query string object. Primitive values and arrays are supported.",
            additionalProperties: true,
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flash_create_csv",
      description:
        "Create a CSV file from tabular JSON rows you already retrieved via tools and return a download link.",
      parameters: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            description:
              "Array of objects representing rows for CSV export.",
            items: {
              type: "object",
              additionalProperties: true,
            },
          },
          filename: {
            type: "string",
            description:
              "Optional filename ending in .csv (example: device-inventory.csv).",
          },
          columns: {
            type: "array",
            description:
              "Optional explicit column order/selection. Defaults to discovered keys.",
            items: { type: "string" },
          },
        },
        required: ["rows"],
      },
    },
  },
];

// ─── Tool Execution ─────────────────────────────────────────────────────────

export interface RuntimeContext {
  auth: AuthContext;
  workspaceId: string;
  environmentId: string;
  environmentName: string;
  enterpriseName: string | null;
  accessToken: string;
  projectId: string;
  permissionMatrix: PermissionMatrix;
  userRole: string;
  accessibleGroupIds: string[] | null;
  apiBaseUrl: string;
  flashiApiKey: string;
}

function getEnterpriseFromAmapiToolArgs(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  switch (toolName) {
    case "amapi_list_devices":
    case "amapi_list_policies":
    case "amapi_list_web_apps":
      return extractEnterprisePrefix(args.enterprise_name);
    case "amapi_get_device":
      return extractEnterprisePrefix(args.device_name);
    case "amapi_get_policy":
      return extractEnterprisePrefix(args.policy_name);
    case "amapi_get_application":
      return extractEnterprisePrefix(args.application_name);
    case "amapi_get_web_app":
      return extractEnterprisePrefix(args.web_app_name);
    default:
      return null;
  }
}

export function validateAmapiToolScope(
  toolName: string,
  args: Record<string, unknown>,
  ctx: RuntimeContext,
): string | null {
  if (ctx.accessibleGroupIds && ctx.accessibleGroupIds.length > 0) {
    return "Permission denied: AMAPI enterprise tools are unavailable for group-scoped access.";
  }

  const expectedEnterprise = extractEnterprisePrefix(ctx.enterpriseName);
  if (!expectedEnterprise) {
    return "AMAPI is unavailable because this environment is not bound to an enterprise.";
  }

  const requestedEnterprise = getEnterpriseFromAmapiToolArgs(toolName, args);
  if (!requestedEnterprise) {
    return "Invalid AMAPI request: enterprise-scoped resource name is required.";
  }
  if (requestedEnterprise !== expectedEnterprise) {
    return "Permission denied: requested enterprise does not match the active environment.";
  }

  if (!ctx.accessToken || !ctx.projectId) {
    return "AMAPI is unavailable because Google credentials are not configured for this workspace.";
  }

  return null;
}

/**
 * Execute a single tool call, returning the result as a string.
 */
async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: RuntimeContext,
): Promise<string> {
  // AMAPI MCP tools — proxy via MCP endpoint
  if (toolName.startsWith("amapi_")) {
    if (
      !checkPermission(
        ctx.auth,
        "device",
        "read",
        ctx.userRole,
        ctx.permissionMatrix,
      )
    ) {
      return `Permission denied: my configured assistant role (${ctx.userRole}) does not have access to device/enterprise data.`;
    }
    const scopeError = validateAmapiToolScope(toolName, args, ctx);
    if (scopeError) return scopeError;

    return executeAmapiTool(toolName, args, ctx);
  }

  // Flash internal tools
  return executeFlashTool(toolName, args, ctx);
}

async function executeAmapiTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: RuntimeContext,
): Promise<string> {
  const MAX_AUTO_PAGES = 20;
  const MAX_AUTO_ITEMS = 2000;
  const DEFAULT_AMAPI_PAGE_SIZE = 100;
  const MAX_AMAPI_PAGE_SIZE = 100;

  const resolvePageSize = (raw: unknown): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AMAPI_PAGE_SIZE;
    return Math.min(Math.floor(parsed), MAX_AMAPI_PAGE_SIZE);
  };

  const toolToRpcMethod: Record<
    string,
    {
      method: string;
      buildParams: (args: Record<string, unknown>) => Record<string, unknown>;
    }
  > = {
    amapi_list_devices: {
      method: "tools/call",
      buildParams: (a) => ({
        name: "list_devices",
        arguments: {
          parent: String(a.enterprise_name || ""),
          pageSize: resolvePageSize(a.page_size),
          ...(a.page_token ? { pageToken: String(a.page_token) } : {}),
        },
      }),
    },
    amapi_get_device: {
      method: "tools/call",
      buildParams: (a) => ({
        name: "get_device",
        arguments: { name: String(a.device_name || "") },
      }),
    },
    amapi_list_policies: {
      method: "tools/call",
      buildParams: (a) => ({
        name: "list_policies",
        arguments: {
          parent: String(a.enterprise_name || ""),
          pageSize: resolvePageSize(a.page_size),
          ...(a.page_token ? { pageToken: String(a.page_token) } : {}),
        },
      }),
    },
    amapi_get_policy: {
      method: "tools/call",
      buildParams: (a) => ({
        name: "get_policy",
        arguments: { name: String(a.policy_name || "") },
      }),
    },
    amapi_get_application: {
      method: "tools/call",
      buildParams: (a) => ({
        name: "get_application",
        arguments: { name: String(a.application_name || "") },
      }),
    },
    amapi_list_web_apps: {
      method: "tools/call",
      buildParams: (a) => ({
        name: "list_web_apps",
        arguments: {
          parent: String(a.enterprise_name || ""),
          pageSize: resolvePageSize(a.page_size),
          ...(a.page_token ? { pageToken: String(a.page_token) } : {}),
        },
      }),
    },
    amapi_get_web_app: {
      method: "tools/call",
      buildParams: (a) => ({
        name: "get_web_app",
        arguments: { name: String(a.web_app_name || "") },
      }),
    },
  };

  const listToolConfig: Partial<
    Record<string, { itemKey: "devices" | "policies" | "webApps" }>
  > = {
    amapi_list_devices: { itemKey: "devices" },
    amapi_list_policies: { itemKey: "policies" },
    amapi_list_web_apps: { itemKey: "webApps" },
  };

  const mapping = toolToRpcMethod[toolName];
  if (!mapping) return `Unknown AMAPI tool: ${toolName}`;

  const callAmapi = async (
    callArgs: Record<string, unknown>,
  ): Promise<unknown> => {
    const rpcBody = JSON.stringify({
      jsonrpc: "2.0",
      method: mapping.method,
      params: mapping.buildParams(callArgs),
      id: `flashi-${Date.now()}`,
    });
    const result = await proxyToAmapiMcp({
      body: rpcBody,
      accessToken: ctx.accessToken,
      projectId: ctx.projectId,
    });
    if (result.status !== 200) {
      throw new Error(
        `AMAPI MCP error (HTTP ${result.status}): ${result.body.slice(0, 500)}`,
      );
    }
    return parseMcpToolPayload(result.body);
  };

  try {
    const listConfig = listToolConfig[toolName];
    const hasExplicitPageToken =
      typeof args.page_token === "string" && args.page_token.trim().length > 0;

    let parsedPayload: unknown;
    if (!listConfig || hasExplicitPageToken) {
      parsedPayload = await callAmapi(args);
    } else {
      const collected: Array<Record<string, unknown>> = [];
      let nextPageToken: string | undefined;
      let truncated = false;
      let pagesFetched = 0;

      for (let page = 0; page < MAX_AUTO_PAGES; page++) {
        pagesFetched += 1;
        const pageArgs: Record<string, unknown> = { ...args };
        if (nextPageToken) pageArgs.page_token = nextPageToken;
        else delete pageArgs.page_token;

        const pagePayloadRaw = await callAmapi(pageArgs);
        const pagePayload =
          pagePayloadRaw && typeof pagePayloadRaw === "object"
            ? (pagePayloadRaw as Record<string, unknown>)
            : {};
        const pageItems = Array.isArray(pagePayload[listConfig.itemKey])
          ? (pagePayload[listConfig.itemKey] as Array<Record<string, unknown>>)
          : [];
        collected.push(...pageItems);
        nextPageToken =
          typeof pagePayload.nextPageToken === "string" &&
          pagePayload.nextPageToken
            ? pagePayload.nextPageToken
            : undefined;

        if (collected.length >= MAX_AUTO_ITEMS) {
          truncated = true;
          break;
        }
        if (!nextPageToken) break;
      }

      parsedPayload = {
        [listConfig.itemKey]: collected.slice(0, MAX_AUTO_ITEMS),
        nextPageToken: nextPageToken || null,
        autoPagination: {
          pagesFetched,
          truncated,
        },
      };
    }

    const cleanedPayload = sanitiseToolPayloadForModel(toolName, parsedPayload);
    const content = serializeToolPayload(cleanedPayload);
    return content.slice(0, MAX_TOOL_CONTENT_CHARS);
  } catch (err) {
    return err instanceof Error && err.message.startsWith("AMAPI MCP error")
      ? err.message
      : `AMAPI MCP call failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface OpenApiRouteEntry {
  template: string;
  summary: string;
  regex: RegExp;
  queryParams: string[];
}

let openApiRouteCache: OpenApiRouteEntry[] | null = null;
let openApiCatalogTextCache: string | null = null;

function templateToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\\\{[^/]+\\\}/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

function normalizeApiPath(rawPath: string): string {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return parsed.pathname;
  } catch {
    return trimmed.split("?")[0] ?? "";
  }
}

async function loadOpenApiRoutes(): Promise<OpenApiRouteEntry[]> {
  if (openApiRouteCache) return openApiRouteCache;
  const schemaPath = join(process.cwd(), "public", "openapi.json");
  const text = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(text) as {
    paths?: Record<string, Record<string, Record<string, unknown>>>;
  };

  const routes: OpenApiRouteEntry[] = [];
  const paths = schema.paths ?? {};
  for (const [template, operations] of Object.entries(paths)) {
    const operation = operations?.get;
    if (!operation) continue;
    if (
      template.startsWith("/api/flashagent") ||
      template.startsWith("/api/mcp/") ||
      template.startsWith("/api/api-keys/")
    ) {
      continue;
    }
    const queryParams = Array.isArray(operation.parameters)
      ? operation.parameters
          .filter((p) => p && typeof p === "object")
          .map((p) => p as Record<string, unknown>)
          .filter((p) => p.in === "query" && typeof p.name === "string")
          .map((p) => String(p.name))
      : [];
    routes.push({
      template,
      summary:
        (typeof operation.summary === "string" && operation.summary.trim()) ||
        (typeof operation.description === "string" &&
          operation.description.trim()) ||
        "No summary",
      regex: templateToRegex(template),
      queryParams,
    });
  }
  openApiRouteCache = routes;
  return routes;
}

async function getOpenApiCatalogText(): Promise<string> {
  if (openApiCatalogTextCache) return openApiCatalogTextCache;
  const routes = await loadOpenApiRoutes();
  const lines: string[] = [];
  for (const route of routes) {
    const queryHint =
      route.queryParams.length > 0 ? `?${route.queryParams.join(",")}` : "";
    lines.push(`- GET ${route.template}${queryHint} — ${route.summary}`);
  }
  openApiCatalogTextCache = lines.join("\n").slice(0, 18_000);
  return openApiCatalogTextCache;
}

function addQueryParams(
  url: URL,
  queryValue: unknown,
  scope: { workspaceId: string; environmentId: string },
  routeQueryParams: string[],
): void {
  // Intentionally clone model-supplied query args so we can safely enforce scope
  // constraints (environment/workspace) without mutating caller-owned objects.
  const queryObj =
    queryValue && typeof queryValue === "object" && !Array.isArray(queryValue)
      ? ({ ...(queryValue as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const routeParamSet = new Set(routeQueryParams);
  const acceptsWorkspaceId = routeParamSet.has("workspace_id");

  // Always bind Flash API reads to the active environment.
  queryObj.environment_id = scope.environmentId;

  // Enforce workspace scope when requested by route metadata or model args.
  // This prevents invalid model-supplied values like workspace names.
  if (acceptsWorkspaceId || "workspace_id" in queryObj) {
    queryObj.workspace_id = scope.workspaceId;
  }

  for (const [key, value] of Object.entries(queryObj)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        url.searchParams.append(key, String(entry));
      }
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      url.searchParams.set(key, String(value));
    }
  }
}

async function executeFlashTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: RuntimeContext,
): Promise<string> {
  if (toolName === "flash_create_csv") {
    return executeFlashCreateCsvTool(args, ctx);
  }

  if (toolName !== "flash_api_get") {
    return `Unknown Flash tool: ${toolName}`;
  }
  if (!ctx.flashiApiKey) {
    return "Flashi API key is not configured for this environment.";
  }

  try {
    const normalizedPath = normalizeApiPath(String(args.path || ""));
    if (!normalizedPath.startsWith("/api/")) {
      return "Invalid Flash API path: must start with /api/.";
    }

    const routes = await loadOpenApiRoutes();
    const matchedRoute =
      routes.find((route) => route.template === normalizedPath) ??
      routes.find((route) => route.regex.test(normalizedPath));
    if (!matchedRoute) {
      return "Requested API route is not available in the GET OpenAPI catalog.";
    }

    const url = new URL(normalizedPath, ctx.apiBaseUrl);
    addQueryParams(
      url,
      args.query,
      { workspaceId: ctx.workspaceId, environmentId: ctx.environmentId },
      matchedRoute.queryParams,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ctx.flashiApiKey}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const responseText = await response.text();
    if (!response.ok) {
      return `Flash API error (HTTP ${response.status}): ${responseText.slice(0, 1200)}`;
    }
    const payload = tryParseJson(responseText) ?? responseText;
    return serializeToolPayload(payload).slice(0, MAX_TOOL_CONTENT_CHARS);
  } catch (err) {
    return `Flash API tool error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function sanitizeCsvCell(value: string): string {
  if (value.length === 0) return value;
  // Prevent spreadsheet formula injection in CSV consumers.
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function normalizeCsvFilename(value: unknown): string {
  const fallback = `flashi-export-${Date.now()}.csv`;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  const ascii = trimmed.replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
  const bounded = ascii.slice(0, 80);
  const withExt = bounded.endsWith(".csv") ? bounded : `${bounded}.csv`;
  return withExt.length > 4 ? withExt : fallback;
}

function coerceCsvPrimitive(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function inferColumns(rows: Array<Record<string, unknown>>): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) out.add(key);
  }
  return [...out];
}

function buildCsvContent(
  rows: Array<Record<string, unknown>>,
  columns: string[],
): string {
  const header = columns.map((column) => sanitizeCsvCell(column)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((column) => {
        const raw = sanitizeCsvCell(coerceCsvPrimitive(row[column]));
        if (raw.includes(",") || raw.includes("\n") || raw.includes('"')) {
          return `"${raw.replace(/"/g, '""')}"`;
        }
        return raw;
      })
      .join(","),
  );
  return [header, ...lines].join("\n");
}

async function executeFlashCreateCsvTool(
  args: Record<string, unknown>,
  ctx: RuntimeContext,
): Promise<string> {
  const MAX_ROWS = 5000;
  const MAX_COLUMNS = 200;
  const MAX_CSV_BYTES = 2_500_000;

  const rawRows = Array.isArray(args.rows) ? args.rows : null;
  if (!rawRows) {
    return "CSV export failed: rows must be an array of objects.";
  }

  const rows = rawRows
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    )
    .slice(0, MAX_ROWS);
  if (rows.length === 0) {
    return "CSV export failed: no valid object rows were provided.";
  }

  const requestedColumns = Array.isArray(args.columns)
    ? args.columns
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const columns = (
    requestedColumns.length > 0 ? requestedColumns : inferColumns(rows)
  ).slice(0, MAX_COLUMNS);
  if (columns.length === 0) {
    return "CSV export failed: no columns available to export.";
  }

  const csv = buildCsvContent(rows, columns);
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) {
    return "CSV export failed: generated file is too large. Reduce rows/columns and try again.";
  }

  const exportId = crypto.randomUUID();
  const filename = normalizeCsvFilename(args.filename);
  const key = `flashagent/${ctx.workspaceId}/${ctx.environmentId}/${exportId}.csv`;

  try {
    await storeBlob("exports", key, csv, {
      workspace_id: ctx.workspaceId,
      environment_id: ctx.environmentId,
      generated_by: "flashagent",
      filename,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    return `CSV export failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const downloadUrl = new URL("/api/flashagent/download", ctx.apiBaseUrl);
  downloadUrl.searchParams.set("id", exportId);
  downloadUrl.searchParams.set("environment_id", ctx.environmentId);
  downloadUrl.searchParams.set("filename", filename);

  return JSON.stringify({
    export_id: exportId,
    filename,
    row_count: rows.length,
    columns,
    download_url: downloadUrl.toString(),
  });
}

// ─── OpenAI Integration ─────────────────────────────────────────────────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function isRetryableStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

async function callOpenAI(
  apiKey: string,
  model: string,
  messages: OpenAIMessage[],
  tools?: ToolDefinition[],
): Promise<Record<string, unknown>> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: 2000,
        temperature: 0.2,
      };
      if (tools && tools.length > 0) {
        body.tools = tools;
      }

      const controller = new AbortController();
      const fetchTimeout = setTimeout(
        () => controller.abort(),
        OPENAI_FETCH_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(fetchTimeout);
      }

      const json = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (response.ok) return json;

      // Sanitise error — never expose raw OpenAI error details in logs
      const errorObj = (json as Record<string, unknown>)?.error as
        | Record<string, unknown>
        | undefined;
      const errMsg = errorObj?.message
        ? `OpenAI error: ${String(errorObj.message).slice(0, 200)}`
        : `OpenAI HTTP ${response.status}`;

      if (isRetryableStatus(response.status) && attempt < OPENAI_MAX_RETRIES) {
        const backoffMs =
          OPENAI_RETRY_BASE_MS * 2 ** (attempt - 1) +
          Math.floor(Math.random() * 200);
        await sleep(backoffMs);
        lastError = new Error(errMsg);
        continue;
      }

      throw new Error(errMsg);
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("OpenAI")) {
        lastError = err;
        if (attempt < OPENAI_MAX_RETRIES) {
          const backoffMs = OPENAI_RETRY_BASE_MS * 2 ** (attempt - 1);
          await sleep(backoffMs);
          continue;
        }
      }
      throw err;
    }
  }

  throw lastError ?? new Error("OpenAI request failed after retries");
}

// ─── Main Runtime Loop ──────────────────────────────────────────────────────

export interface RunFlashiOptions {
  systemPrompt: string;
  userMessage: string;
  contextMessages: Array<{ role: string; text: string }>;
  runtimeCtx: RuntimeContext;
  apiKeyOverride?: string | null;
  modelOverride?: string | null;
}

export interface FlashiResult {
  reply: string;
  toolCallCount: number;
  dataSource: "none" | "mcp" | "api" | "mixed";
}

/**
 * Run the Flashi tool-calling loop.
 */
export async function runFlashi(
  options: RunFlashiOptions,
): Promise<FlashiResult> {
  const apiKey = options.apiKeyOverride?.trim() || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model =
    options.modelOverride?.trim() ||
    process.env.FLASHAGENT_MODEL ||
    DEFAULT_MODEL;

  // Build tool list
  const tools: ToolDefinition[] = [...AMAPI_MCP_TOOLS, ...FLASH_INTERNAL_TOOLS];
  const openApiCatalog = await getOpenApiCatalogText().catch(() => "");

  // Build messages
  const messages: OpenAIMessage[] = [
    { role: "system", content: options.systemPrompt },
  ];
  if (openApiCatalog) {
    messages.push({
      role: "system",
      content:
        `Flashi has a dedicated environment-scoped API key and can call read-only Flash REST endpoints using tool flash_api_get.\n` +
        `Active workspace_id: ${options.runtimeCtx.workspaceId}\n` +
        `Active environment_id: ${options.runtimeCtx.environmentId}\n` +
        `When an endpoint expects workspace_id/environment_id query params, always use these IDs and never workspace/environment names.\n` +
        `OpenAPI GET route catalog:\n${openApiCatalog}`,
    });
  }

  // Add conversation history
  for (const msg of options.contextMessages) {
    const role = msg.role === "user" ? "user" : "assistant";
    messages.push({ role, content: msg.text });
  }

  // Add current user message
  messages.push({ role: "user", content: options.userMessage });

  let toolCallCount = 0;
  let mcpToolCallCount = 0;
  let apiToolCallCount = 0;
  const startTime = Date.now();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Check total execution budget before each round
    if (Date.now() - startTime > TOTAL_EXECUTION_BUDGET_MS) {
      // Budget exceeded — ask LLM for a final answer with data gathered so far
      messages.push({
        role: "user",
        content:
          "The request has taken too long. Please provide your best answer based on the data gathered so far.",
      });
      const timeoutCompletion = await callOpenAI(apiKey, model, messages);
      const timeoutMessage = (
        timeoutCompletion as { choices?: Array<{ message?: OpenAIMessage }> }
      ).choices?.[0]?.message;
      return {
        reply:
          timeoutMessage?.content ||
          "I ran out of time processing your request. Please try a more specific question.",
        toolCallCount,
        dataSource:
          mcpToolCallCount > 0 && apiToolCallCount > 0
            ? "mixed"
            : mcpToolCallCount > 0
              ? "mcp"
              : apiToolCallCount > 0
                ? "api"
                : "none",
      };
    }

    const completion = await callOpenAI(apiKey, model, messages, tools);

    const choices = (
      completion as { choices?: Array<{ message?: OpenAIMessage }> }
    ).choices;
    const assistantMessage = choices?.[0]?.message;
    if (!assistantMessage) {
      return {
        reply: "I was unable to generate a response. Please try again.",
        toolCallCount,
      };
    }

    // If no tool calls, we have a final response
    if (
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
      return {
        reply:
          assistantMessage.content || "I was unable to generate a response.",
        toolCallCount,
        dataSource:
          mcpToolCallCount > 0 && apiToolCallCount > 0
            ? "mixed"
            : mcpToolCallCount > 0
              ? "mcp"
              : apiToolCallCount > 0
                ? "api"
                : "none",
      };
    }

    // Append assistant message with tool calls to conversation
    messages.push(assistantMessage);

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      toolCallCount++;
      if (toolCall.function.name.startsWith("amapi_")) {
        mcpToolCallCount++;
      } else if (
        toolCall.function.name === "flash_api_get" ||
        toolCall.function.name === "flash_create_csv"
      ) {
        apiToolCallCount++;
      }
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        // Invalid JSON from LLM
      }

      const result = await executeTool(
        toolCall.function.name,
        toolArgs,
        options.runtimeCtx,
      );

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.slice(0, MAX_TOOL_CONTENT_CHARS),
      });
    }
  }

  // Exhausted tool rounds — ask LLM for final answer without tools
  messages.push({
    role: "user",
    content:
      "You have used the maximum number of tool calls. Please provide your best answer based on the data gathered so far.",
  });

  const finalCompletion = await callOpenAI(apiKey, model, messages);
  const finalMessage = (
    finalCompletion as { choices?: Array<{ message?: OpenAIMessage }> }
  ).choices?.[0]?.message;

  return {
    reply:
      finalMessage?.content ||
      "I reached the tool call limit and could not complete the query. Please try a more specific question.",
    toolCallCount,
    dataSource:
      mcpToolCallCount > 0 && apiToolCallCount > 0
        ? "mixed"
        : mcpToolCallCount > 0
          ? "mcp"
          : apiToolCallCount > 0
            ? "api"
            : "none",
  };
}

// Testing hook for direct permission/scope verification without running OpenAI loop.
export async function executeToolForTests(
  toolName: string,
  args: Record<string, unknown>,
  ctx: RuntimeContext,
): Promise<string> {
  return executeTool(toolName, args, ctx);
}
