import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/auth.js", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("../_lib/rbac.js", () => ({
  requireWorkspaceResourcePermission: vi.fn(),
}));

vi.mock("../_lib/flashagent-settings.js", () => ({
  getWorkspaceAssistantSettings: vi.fn(),
  setWorkspaceAssistantSettings: vi.fn(),
}));

vi.mock("../_lib/audit.js", () => ({
  logAudit: vi.fn(),
}));

import { requireAuth } from "../_lib/auth.js";
import { requireWorkspaceResourcePermission } from "../_lib/rbac.js";
import {
  getWorkspaceAssistantSettings,
  setWorkspaceAssistantSettings,
} from "../_lib/flashagent-settings.js";
import handler from "../flashagent-workspace-settings.ts";

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireWorkspaceResourcePermission = vi.mocked(requireWorkspaceResourcePermission);
const mockGetWorkspaceAssistantSettings = vi.mocked(getWorkspaceAssistantSettings);
const mockSetWorkspaceAssistantSettings = vi.mocked(setWorkspaceAssistantSettings);

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("flashagent-workspace-settings authorization", () => {
  beforeEach(() => {
    mockRequireAuth.mockReset();
    mockRequireWorkspaceResourcePermission.mockReset();
    mockGetWorkspaceAssistantSettings.mockReset();
    mockSetWorkspaceAssistantSettings.mockReset();

    mockRequireAuth.mockResolvedValue({
      authType: "session",
      sessionId: "sess_1",
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "qa@example.com",
      },
    } as never);

    mockRequireWorkspaceResourcePermission.mockResolvedValue("admin" as never);
    mockGetWorkspaceAssistantSettings.mockResolvedValue({
      platform_assistant_enabled: true,
      workspace_assistant_enabled: true,
      workspace_assistant_max_role: "admin",
      workspace_assistant_default_role: "viewer",
      workspace_openai_override_configured: false,
      workspace_openai_model: null,
    });
  });

  it("uses workspace read permission for GET", async () => {
    const res = await handler(
      new Request(
        `http://localhost/api/flashagent/workspace-settings?workspace_id=${WORKSPACE_ID}`,
        { method: "GET" },
      ),
      {} as never,
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      "workspace",
      "read",
    );
    const body = await res.json();
    expect(body.openai_api_key).toBeUndefined();
    expect(body.workspace_openai_override_configured).toBe(false);
  });

  it("uses workspace manage_settings permission for PUT", async () => {
    const res = await handler(
      new Request("http://localhost/api/flashagent/workspace-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          assistant_enabled: false,
          max_role: "member",
          default_role: "viewer",
          openai_model: "gpt-4.1-mini",
        }),
      }),
      {} as never,
    );

    expect(res.status).toBe(200);
    expect(mockRequireWorkspaceResourcePermission).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_ID,
      "workspace",
      "manage_settings",
    );
    expect(mockSetWorkspaceAssistantSettings).toHaveBeenCalledWith(
      WORKSPACE_ID,
      expect.objectContaining({
        assistant_enabled: false,
        max_role: "member",
        default_role: "viewer",
        openai_model: "gpt-4.1-mini",
      }),
    );
  });

  it("blocks API keys from mutating workspace settings", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      authType: "api_key",
      sessionId: null,
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "api@example.com",
      },
      apiKey: {
        id: "ak_1",
      },
    } as never);

    const res = await handler(
      new Request("http://localhost/api/flashagent/workspace-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          assistant_enabled: true,
        }),
      }),
      {} as never,
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "API keys cannot update workspace assistant settings",
    });
    expect(mockSetWorkspaceAssistantSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid ceiling role values", async () => {
    const res = await handler(
      new Request("http://localhost/api/flashagent/workspace-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          workspace_id: WORKSPACE_ID,
          max_role: "owner",
        }),
      }),
      {} as never,
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "max_role must be one of viewer, member, admin",
    });
    expect(mockSetWorkspaceAssistantSettings).not.toHaveBeenCalled();
  });
});
