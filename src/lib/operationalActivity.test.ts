import { afterEach, expect, it, vi } from "vitest";

type Batch = {
  events: Array<Record<string, unknown>>;
  dropped: number;
  unconfirmed?: number;
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function fixture(configFailures = 0) {
  vi.useFakeTimers();
  const browser = new EventTarget();
  vi.stubGlobal(
    "window",
    Object.assign(browser, { innerWidth: 800, innerHeight: 600 }),
  );
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("location", { pathname: "/devices" });
  const batches: Batch[] = [];
  let identity = "first";
  let holdUpload = false;
  let product = async (): Promise<Response> => Response.json({});
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/auth/config") {
      if (configFailures-- > 0) return new Response(null, { status: 503 });
      return Response.json({ operational_trace_enabled: true });
    }
    if (path !== "/api/activity") return product();
    const batch: Batch = JSON.parse(String(init?.body));
    const binding = new Headers(init?.headers).get("X-Flash-Activity-Binding");
    if (!binding && !batch.events.length && !batch.dropped)
      return new Response(null, {
        status: 204,
        headers: { "X-Flash-Activity-Binding": identity },
      });
    if (binding !== identity) return new Response(null, { status: 409 });
    if (holdUpload) return new Promise<Response>(() => {});
    batches.push(batch);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const activity = await import("./operationalActivity");
  activity.installOperationalActivity();
  await vi.advanceTimersByTimeAsync(0);
  const { apiClient } = await import("../api/client");
  return {
    activity,
    apiClient,
    browser,
    batches,
    hold: () => {
      holdUpload = true;
    },
    setProduct: (fn: typeof product) => {
      product = fn;
    },
    setIdentity: (id: string) => {
      identity = id;
    },
  };
}

it("rejects completions across local and externally changed sessions", async () => {
  const f = await fixture();
  let resolve!: (r: Response) => void;
  f.setProduct(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const old = f.apiClient.get("/api/devices");
  f.setProduct(async () => {
    f.setIdentity("second");
    return Response.json({});
  });
  await f.apiClient.post("/api/auth/password-change");
  await vi.advanceTimersByTimeAsync(0);
  resolve(Response.json({}));
  await old;
  f.activity.recordActivity("click");
  await vi.advanceTimersByTimeAsync(5000);
  expect(
    f.batches
      .flatMap((batch) => batch.events)
      .some((e) => e.api_route === "/api/devices"),
  ).toBe(false);
  expect(f.batches.at(-1)).toMatchObject({ events: [{ kind: "click" }] });
  expect(f.batches.at(-1)!.dropped).toBeGreaterThan(0);
  // Simulate a magic link in another tab without any storage event.
  f.activity.recordActivity("submit");
  f.setIdentity("third");
  await vi.advanceTimersByTimeAsync(5000);
  f.activity.recordActivity("change");
  await vi.advanceTimersByTimeAsync(5000);
  expect(
    f.batches.flatMap((batch) => batch.events).some((e) => e.kind === "submit"),
  ).toBe(false);
  expect(f.batches.at(-1)).toMatchObject({
    events: [{ kind: "change" }],
    dropped: 0,
  });
});

it("preserves product errors and excludes their text, including multiline fake frames", async () => {
  const f = await fixture();
  const error = new TypeError("private\n    at /assets/fixture-secret.js:1:2");
  f.setProduct(
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.error(error);
          },
        }),
        { headers: { "X-Flash-Request-ID": "fixture-id" } },
      ),
  );
  await expect(
    f.apiClient.get("/api/devices?token=fixture-secret"),
  ).rejects.toBe(error);
  f.activity.reportReactError(error);
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.batches.flatMap((b) => b.events)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "api_failure",
        status: 200,
        api_route: "/api/devices",
        server_request_id: "fixture-id",
      }),
      expect.objectContaining({
        kind: "react_error",
        error_class: "TypeError",
      }),
    ]),
  );
  expect(JSON.stringify(f.batches)).not.toContain("fixture-secret");
  expect(
    f.batches.flatMap((b) => b.events).some((e) => e.kind === "api_result"),
  ).toBe(false);
});

it("reports the remaining queue alongside the last bounded unload batch", async () => {
  const f = await fixture();
  for (let i = 0; i < 100; i++) f.activity.recordActivity("click");
  f.browser.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(0);
  const batch = f.batches.at(-1)!;
  expect(batch.events.length).toBe(25);
  expect(batch.events.length + batch.dropped).toBe(101); // Includes initial navigation.
});

it("remains usable without crypto.randomUUID, including when disabled", async () => {
  vi.stubGlobal("crypto", {});
  const { recordNavigation } = await import("./operationalActivity");
  expect(() => recordNavigation()).not.toThrow();
  const f = await fixture();
  expect(() => f.activity.recordNavigation()).not.toThrow();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.batches[0].events[0]).not.toHaveProperty("interaction_id");
});

it("recovers only the unacknowledged count when a document dies during a periodic upload", async () => {
  let slot: string | null = null;
  vi.stubGlobal("sessionStorage", {
    getItem: () => slot,
    setItem: (_: string, value: string) => {
      slot = value;
    },
  });
  const first = await fixture();
  first.activity.recordActivity("submit");
  first.hold();
  await vi.advanceTimersByTimeAsync(5000);
  first.browser.dispatchEvent(new Event("pagehide"));
  vi.clearAllTimers();
  vi.resetModules();
  const second = await fixture();
  await vi.advanceTimersByTimeAsync(5000);
  expect(second.batches[0]).toMatchObject({
    unconfirmed: 2,
    dropped: 0,
    events: [{ kind: "navigation" }],
  });
  expect(slot).toMatch(/:0:0$/);
});

it("never submits an oversized byte batch, including a final flush", async () => {
  const f = await fixture();
  for (let i = 0; i < 80; i++)
    f.activity.recordActivity("change", { fixture: "é".repeat(700) });
  f.browser.dispatchEvent(new Event("pagehide"));
  await vi.advanceTimersByTimeAsync(0);
  const batch = f.batches.at(-1)!;
  expect(
    new TextEncoder().encode(JSON.stringify(batch)).length,
  ).toBeLessThanOrEqual(16384);
  expect(batch.events.length + batch.dropped).toBe(81);
});

it.each([
  ["/api/auth/login", {}],
  ["/api/auth/logout", {}],
  ["/api/auth/register", {}],
  ["/api/auth/magic-link-complete", {}],
  ["/api/auth/password-reset-complete", {}],
  ["/api/superadmin/actions", { action: "impersonate" }],
  ["/api/superadmin/actions", { action: "stop_impersonation" }],
] as const)(
  "dispatches the old batch before the identity-changing %s request",
  async (path, body) => {
    const f = await fixture();
    f.activity.recordActivity("submit");
    f.setProduct(async () => {
      expect(f.batches[0].events.some((event) => event.kind === "submit")).toBe(
        true,
      );
      f.setIdentity("changed");
      return Response.json({});
    });
    await f.apiClient.post(path, body);
    await vi.advanceTimersByTimeAsync(0);
    f.activity.recordActivity("change");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.batches.at(-1)?.events.map((event) => event.kind)).toEqual([
      "change",
    ]);
  },
);

it("recovers after a transient failure fetching the collection setting", async () => {
  const f = await fixture(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.batches.flatMap((b) => b.events).map((e) => e.kind)).toEqual([
    "navigation",
  ]);
});
