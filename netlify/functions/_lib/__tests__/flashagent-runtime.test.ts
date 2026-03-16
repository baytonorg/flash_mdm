import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../mcp-proxy.js", () => ({
  proxyToAmapiMcp: vi.fn(),
}));
vi.mock("../blobs.js", () => ({
  storeBlob: vi.fn(),
}));

import { proxyToAmapiMcp } from "../mcp-proxy.js";
import { storeBlob } from "../blobs.js";
import {
  executeToolForTests,
  validateAmapiToolScope,
  type RuntimeContext,
} from "../flashagent-runtime.js";

const mockProxyToAmapiMcp = vi.mocked(proxyToAmapiMcp);
const mockStoreBlob = vi.mocked(storeBlob);
const mockFetch = vi.fn<typeof fetch>();

function makeRuntimeContext(
  overrides: Partial<RuntimeContext> = {},
): RuntimeContext {
  return {
    auth: {
      authType: "session",
      sessionId: "sess_1",
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "qa@example.com",
        first_name: "QA",
        last_name: "User",
        is_superadmin: false,
        totp_enabled: false,
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        environment_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        active_group_id: null,
      },
    },
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    environmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    environmentName: "Env A",
    enterpriseName: "enterprises/LC123",
    accessToken: "token",
    projectId: "project-1",
    permissionMatrix: {
      device: { read: "viewer" },
      group: { read: "viewer" },
      policy: { read: "viewer" },
      workspace: { read: "viewer" },
      billing: { license_view: "viewer" },
    },
    userRole: "admin",
    accessibleGroupIds: null,
    apiBaseUrl: "http://localhost",
    flashiApiKey: "flash_environment_key",
    ...overrides,
  };
}

describe("flashagent-runtime security controls", () => {
  beforeEach(() => {
    mockProxyToAmapiMcp.mockReset();
    mockStoreBlob.mockReset();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("rejects AMAPI enterprise mismatch", () => {
    const ctx = makeRuntimeContext();

    const err = validateAmapiToolScope(
      "amapi_list_devices",
      {
        enterprise_name: "enterprises/OTHER",
      },
      ctx,
    );

    expect(err).toBe(
      "Permission denied: requested enterprise does not match the active environment.",
    );
  });

  it("rejects AMAPI tools for group-scoped access", async () => {
    const ctx = makeRuntimeContext({
      accessibleGroupIds: ["22222222-2222-4222-8222-222222222222"],
    });

    const result = await executeToolForTests(
      "amapi_list_devices",
      {
        enterprise_name: "enterprises/LC123",
      },
      ctx,
    );

    expect(result).toBe(
      "Permission denied: AMAPI enterprise tools are unavailable for group-scoped access.",
    );
    expect(mockProxyToAmapiMcp).not.toHaveBeenCalled();
  });

  it("parses and sanitises list_devices MCP payloads before returning tool content", async () => {
    mockProxyToAmapiMcp
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "flashi-1",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  devices: [
                    {
                      name: "enterprises/LC123/devices/device-a",
                      state: "ACTIVE",
                      policyCompliant: true,
                      enrollmentTime: "2026-03-01T00:00:00Z",
                      lastStatusReportTime: "2026-03-02T20:00:00Z",
                      lastPolicySyncTime: "2026-03-02T19:00:00Z",
                      hardwareInfo: {
                        model: "Pixel 8",
                        manufacturer: "Google",
                        serialNumber: "ABC123",
                      },
                      softwareInfo: {
                        androidVersion: "14",
                        securityPatchLevel: "2026-02-05",
                        systemUpdateInfo: { updateStatus: "UP_TO_DATE" },
                      },
                      applicationReports: [{ packageName: "com.example.app" }],
                    },
                  ],
                  nextPageToken: "next-token",
                }),
              },
            ],
          },
        }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "flashi-1b",
          result: {
            content: [{ type: "text", text: JSON.stringify({ devices: [] }) }],
          },
        }),
      } as never);

    const ctx = makeRuntimeContext();
    const result = await executeToolForTests(
      "amapi_list_devices",
      { enterprise_name: "enterprises/LC123", page_size: 100 },
      ctx,
    );
    const payload = JSON.parse(result) as {
      summary: { deviceCount: number };
      devices: Array<Record<string, unknown>>;
      nextPageToken: string | null;
    };

    expect(payload.summary.deviceCount).toBe(1);
    expect(payload.nextPageToken).toBeNull();
    expect(payload.devices[0]?.name).toBe("enterprises/LC123/devices/device-a");
    expect(payload.devices[0]?.model).toBe("Pixel 8");
    expect(payload.devices[0]?.manufacturer).toBe("Google");
    expect(payload.devices[0]?.lastStatusReportTime).toBe("2026-03-02T20:00:00Z");
    expect(payload.devices[0]).not.toHaveProperty("applicationReports");
  });

  it("surfaces MCP tool-level errors returned in a HTTP 200 payload", async () => {
    mockProxyToAmapiMcp.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "flashi-2",
        result: {
          isError: true,
          content: [
            { type: "text", text: "Permission denied from upstream MCP" },
          ],
        },
      }),
    } as never);

    const ctx = makeRuntimeContext();
    const result = await executeToolForTests(
      "amapi_list_devices",
      { enterprise_name: "enterprises/LC123" },
      ctx,
    );

    expect(result).toContain(
      "AMAPI MCP call failed: Permission denied from upstream MCP",
    );
  });

  it("forwards pagination params for amapi_list_web_apps", async () => {
    mockProxyToAmapiMcp.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "flashi-3",
        result: { content: [{ type: "text", text: JSON.stringify({ webApps: [] }) }] },
      }),
    } as never);

    const ctx = makeRuntimeContext();
    const result = await executeToolForTests(
      "amapi_list_web_apps",
      {
        enterprise_name: "enterprises/LC123",
        page_size: 25,
        page_token: "token-123",
      },
      ctx,
    );
    expect(result).toContain('"webApps":[]');
    expect(mockProxyToAmapiMcp).toHaveBeenCalledTimes(1);
    const rpcArg = mockProxyToAmapiMcp.mock.calls[0]?.[0];
    const parsed = JSON.parse(String(rpcArg?.body)) as {
      params?: { arguments?: { pageSize?: number; pageToken?: string } };
    };
    expect(parsed.params?.arguments?.pageSize).toBe(25);
    expect(parsed.params?.arguments?.pageToken).toBe("token-123");
  });

  it("auto-paginates amapi_list_policies when no page token is provided", async () => {
    mockProxyToAmapiMcp
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "flashi-4",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  policies: [{ name: "p1" }],
                  nextPageToken: "page-2",
                }),
              },
            ],
          },
        }),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "flashi-5",
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  policies: [{ name: "p2" }],
                }),
              },
            ],
          },
        }),
      } as never);

    const ctx = makeRuntimeContext();
    const result = await executeToolForTests(
      "amapi_list_policies",
      { enterprise_name: "enterprises/LC123" },
      ctx,
    );
    const payload = JSON.parse(result) as {
      policies: Array<{ name: string }>;
      autoPagination?: { pagesFetched: number };
    };
    expect(payload.policies.map((p) => p.name)).toEqual(["p1", "p2"]);
    expect(payload.autoPagination?.pagesFetched).toBe(2);
    expect(mockProxyToAmapiMcp).toHaveBeenCalledTimes(2);
    const firstRpc = JSON.parse(
      String(mockProxyToAmapiMcp.mock.calls[0]?.[0]?.body),
    ) as { params?: { arguments?: { pageSize?: number } } };
    expect(firstRpc.params?.arguments?.pageSize).toBe(100);
  });

  it("rejects non-api paths for flash_api_get", async () => {
    const ctx = makeRuntimeContext();
    const result = await executeToolForTests(
      "flash_api_get",
      { path: "/not-api" },
      ctx,
    );
    expect(result).toContain("must start with /api/");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls allowed GET endpoint with API key and environment query", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    const ctx = makeRuntimeContext();
    const result = await executeToolForTests(
      "flash_api_get",
      { path: "/api/devices/list", query: { page: 1 } },
      ctx,
    );

    expect(result).toContain('"items":[]');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/devices/list?");
    expect(url).toContain("environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer flash_environment_key",
    );
  });

  it("forces active workspace_id for workspace-scoped GET routes", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );
    const ctx = makeRuntimeContext();
    const result = await executeToolForTests(
      "flash_api_get",
      {
        path: "/api/workspaces/users",
        query: { workspace_id: "BAYTONIA", page: 1 },
      },
      ctx,
    );

    expect(result).toContain('"users":[]');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/workspaces/users?");
    expect(url).toContain("workspace_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(url).not.toContain("workspace_id=BAYTONIA");
    expect(url).toContain("environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("creates CSV exports from visible rows and returns a download URL", async () => {
    mockStoreBlob.mockResolvedValueOnce(undefined as never);
    const ctx = makeRuntimeContext();

    const result = await executeToolForTests(
      "flash_create_csv",
      {
        filename: "inventory.csv",
        rows: [
          { device: "A", compliant: true, count: 1 },
          { device: "B", compliant: false, count: 2 },
        ],
      },
      ctx,
    );
    const payload = JSON.parse(result) as {
      filename: string;
      row_count: number;
      download_url: string;
      columns: string[];
    };

    expect(payload.filename).toBe("inventory.csv");
    expect(payload.row_count).toBe(2);
    expect(payload.columns).toEqual(["device", "compliant", "count"]);
    expect(payload.download_url).toContain("/api/flashagent/download?");
    expect(payload.download_url).toContain(
      "environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );

    expect(mockStoreBlob).toHaveBeenCalledTimes(1);
    const [storeName, key, content] = mockStoreBlob.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(storeName).toBe("exports");
    expect(key).toContain(
      "flashagent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/",
    );
    expect(content).toContain("device,compliant,count");
    expect(content).toContain("A,true,1");
  });
});
