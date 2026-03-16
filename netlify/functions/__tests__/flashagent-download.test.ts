import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("../_lib/rbac.js", () => ({
  requireEnvironmentAccessScopeForResourcePermission: vi.fn(),
}));

vi.mock("../_lib/db.js", () => ({
  queryOne: vi.fn(),
}));

vi.mock("../_lib/blobs.js", () => ({
  getBlob: vi.fn(),
}));

import { requireAuth } from "../_lib/auth.js";
import { requireEnvironmentAccessScopeForResourcePermission } from "../_lib/rbac.js";
import { queryOne } from "../_lib/db.js";
import { getBlob } from "../_lib/blobs.js";
import handler from "../flashagent-download.ts";

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireEnvScope = vi.mocked(
  requireEnvironmentAccessScopeForResourcePermission,
);
const mockQueryOne = vi.mocked(queryOne);
const mockGetBlob = vi.mocked(getBlob);

describe("flashagent-download", () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockRequireEnvScope.mockReset();
    mockQueryOne.mockReset();
    mockGetBlob.mockReset();

    mockRequireAuth.mockResolvedValue({
      authType: "session",
      sessionId: "sess_1",
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "qa@example.com",
      },
    } as never);
  });

  it("returns csv content for authorised users", async () => {
    mockQueryOne.mockResolvedValueOnce({
      workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    } as never);
    mockRequireEnvScope.mockResolvedValueOnce({
      mode: "environment",
      role: "viewer",
      accessible_group_ids: null,
    } as never);
    mockGetBlob.mockResolvedValueOnce("device,count\nA,1\nB,2\n");

    const res = await handler(
      new Request(
        "http://localhost/api/flashagent/download?id=22222222-2222-4222-8222-222222222222&environment_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&filename=inventory.csv",
        { method: "GET" },
      ),
      {} as never,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("inventory.csv");
    await expect(res.text()).resolves.toContain("device,count");
    expect(mockGetBlob).toHaveBeenCalledWith(
      "exports",
      "flashagent/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/22222222-2222-4222-8222-222222222222.csv",
    );
  });

  it("rejects invalid identifiers", async () => {
    const res = await handler(
      new Request(
        "http://localhost/api/flashagent/download?id=bad&environment_id=also-bad",
        { method: "GET" },
      ),
      {} as never,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "id and environment_id must be valid UUIDs",
    });
  });
});
