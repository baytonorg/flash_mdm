import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  closeOperationalTrace,
  traceHttp,
} from "../../netlify/functions/_lib/operational-trace.ts";
import { readTraceTail } from "../../netlify/functions/_lib/trace-reader.ts";

test("installer middleware exposes the correlated ID through the real HTTP adapter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flash-http-test-"));
  process.env.FLASH_TRACE_DIR = directory;
  const installer = await readFile(
    new URL("../../install.sh", import.meta.url),
    "utf8",
  );
  const middleware = installer.match(
    /const app = new Hono\(\);\n([\s\S]*?)\napp\.all\('\/api\/activity'/,
  )?.[1];
  assert.ok(middleware);
  const app = new Hono();
  new Function("app", "traceHttp", middleware)(app, traceHttp);
  app.get("/api/example", () =>
    Response.json(
      { success: true },
      { headers: { "Set-Cookie": "fixture=example; HttpOnly" } },
    ),
  );
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  try {
    await once(server, "listening");
    const result = await fetch(
      "http://127.0.0.1:" + server.address().port + "/api/example",
    );
    assert.deepEqual(await result.json(), { success: true });
    assert.equal(result.headers.get("set-cookie"), "fixture=example; HttpOnly");
    const id = result.headers.get("X-Flash-Request-ID");
    assert.ok(id);
    await closeOperationalTrace();
    const tail = await readTraceTail(directory, { requestId: id });
    assert.ok(tail.events.some((event) => event.event === "http.end"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeOperationalTrace();
    delete process.env.FLASH_TRACE_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});
