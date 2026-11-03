// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  admin: vi.fn(),
  event: vi.fn(),
}));
vi.mock("../_lib/auth.js", () => ({
  validateSession: mocks.validate,
  requireSuperadmin: mocks.admin,
}));
vi.mock("../_lib/operational-trace.js", () => ({
  traceEvent: mocks.event,
  traceHealth: () => ({}),
}));
import handler from "../operational-trace.js";

const client = randomUUID();
function post(events: unknown[], extra: Record<string, string> = {}) {
  return handler(
    new Request("https://fixture.invalid/api/activity", {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Flash-Activity-Client": client,
        ...extra,
      },
      body: JSON.stringify({ events }),
    }),
    {} as never,
  );
}
beforeEach(() => {
  vi.stubEnv("FLASH_TRACE_DIR", "/unused-fixture");
  vi.clearAllMocks();
  mocks.validate.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

it("binds uploads to the validated session and rejects late batches without logging fields or frames", async () => {
  mocks.validate.mockResolvedValue({
    sessionId: "session-fixture-A",
    user: { id: "actor-fixture" },
  });
  const init = await post([]);
  expect(init.status).toBe(204);
  expect(mocks.validate).toHaveBeenCalledWith(expect.any(Request), { renew: false });
  const marker = init.headers.get("X-Flash-Activity-Binding")!;
  expect(marker).not.toContain("fixture");
  const samples = [
    {
      kind: "javascript_error",
      route: "/login",
      frames: ["/assets/fixture-secret.js:1:2"],
      checked: true,
      source_line: 17,
      source_column: 3,
      message: "fixture-secret",
    },
  ];
  expect(
    (await post(samples, { "X-Flash-Activity-Binding": marker })).status,
  ).toBe(204);
  expect(mocks.event).toHaveBeenCalledWith("ui.javascript_error", {
    client_reported: true,
    page: "/login",
    source_line: 17,
    source_column: 3,
  });
  mocks.event.mockClear();
  mocks.validate.mockResolvedValue({
    sessionId: "session-fixture-B",
    user: { id: "actor-fixture" },
  });
  expect(
    (await post(samples, { "X-Flash-Activity-Binding": marker })).status,
  ).toBe(409);
  expect(mocks.event.mock.calls).toEqual([
    [
      "ui.collection_gap",
      {
        dropped: 1,
        unconfirmed: 0,
        reason: "session_changed",
        client_reported: true,
      },
    ],
  ]);
});

it("rejects both credential headers, foreign origins and GET without attempting a private read", async () => {
  for (const headers of [
    { Authorization: "Bearer fixture" },
    { "X-API-Key": "fixture" },
    { Origin: "https://elsewhere.invalid" },
  ]) {
    expect((await post([], headers as Record<string, string>)).status).toBe(
      403,
    );
  }
  expect(
    (
      await handler(
        new Request("https://fixture.invalid/api/activity"),
        {} as never,
      )
    ).status,
  ).toBe(405);
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(mocks.admin).not.toHaveBeenCalled();
});

it("limits a single anonymous client while leaving capacity for a different client", async () => {
  const noisy = randomUUID();
  for (let i = 0; i < 20; i++)
    expect((await post([], { "X-Flash-Activity-Client": noisy })).status).toBe(
      204,
    );
  expect((await post([], { "X-Flash-Activity-Client": noisy })).status).toBe(
    429,
  );
  expect(
    (await post([], { "X-Flash-Activity-Client": randomUUID() })).status,
  ).toBe(204);
});

it("bounds session lookups for oversized bodies and repeated fabricated-session uploads", async () => {
  const headers = {
    "X-Flash-Activity-Client": randomUUID(),
    cookie: "flash_session=fixture-invalid",
  };
  expect(
    (await post([], { ...headers, "content-length": "16385" })).status,
  ).toBe(413);
  expect(mocks.validate).not.toHaveBeenCalled();
  for (let i = 0; i < 60; i++) await post([], headers);
  expect(mocks.validate).toHaveBeenCalledTimes(60);
  expect((await post([], headers)).status).toBe(429);
  expect(mocks.validate).toHaveBeenCalledTimes(60);
});

it("exposes invalid skipped rows without retaining their content", async () => {
  const init = await post([]);
  await post([{ kind: "fixture-secret", route: "/login" }, null], {
    "X-Flash-Activity-Binding": init.headers.get("X-Flash-Activity-Binding")!,
  });
  expect(mocks.event.mock.calls).toEqual([
    [
      "ui.collection_gap",
      { dropped: 2, reason: "invalid_events", client_reported: true },
    ],
  ]);
});
