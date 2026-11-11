import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  closeOperationalTrace,
  markTraceApiDocumentationServed,
  traceHttp,
} from "../../netlify/functions/_lib/operational-trace.ts";
import { readTraceTail } from "../../netlify/functions/_lib/trace-reader.ts";

test("VPS HTTP trace preserves request IDs and classifies documentation separately from unexpected HTML", async () => {
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
  const docsStart = installer.indexOf("// Preserve the published Swagger documentation");
  const docsEnd = installer.indexOf("// The API namespace", docsStart);
  assert.ok(docsStart >= 0 && docsEnd > docsStart);
  const docs = installer.slice(docsStart, docsEnd);
  const app = new Hono();
  new Function("app", "traceHttp", middleware)(app, traceHttp);
  app.get("/api/example", () =>
    Response.json(
      { success: true },
      { headers: { "Set-Cookie": "fixture=example; HttpOnly" } },
    ),
  );
  app.get("/api/unexpected-html", (c) => c.html("<p>Wrong representation</p>"));
  new Function(
    "app", "serveStatic", "markTraceApiDocumentationServed",
    docs.replaceAll("'./dist'", "'./public'"),
  )(app, serveStatic, markTraceApiDocumentationServed);
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
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
    const base = "http://127.0.0.1:" + server.address().port;
    const cases = [
      ["/api/docs/", "GET", 200, "success"],
      ["/api/docs/index.html", "HEAD", 200, "success"],
      ["/api/docs/missing.html", "GET", 404, "rejected"],
      ["/api/docs/", "POST", 404, "rejected"],
      ["/api/unexpected-html", "GET", 200, "protocol_failure"],
    ];
    const responses = [];
    for (const [path, method, status, outcome] of cases) {
      const response = await fetch(base + path, { method });
      assert.equal(response.status, status, method + " " + path);
      await response.arrayBuffer();
      responses.push({ path, method, outcome, id: response.headers.get("X-Flash-Request-ID") });
    }
    await closeOperationalTrace();
    for (const expected of responses) {
      assert.ok(expected.id);
      const { events } = await readTraceTail(directory, { requestId: expected.id });
      assert.equal(events.find((e) => e.event === "http.end")?.data.outcome,
        expected.outcome, expected.method + " " + expected.path);
    }
    const tail = await readTraceTail(directory, { requestId: id });
    assert.ok(tail.events.some((event) => event.event === "http.end"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await closeOperationalTrace();
    delete process.env.FLASH_TRACE_DIR;
    await rm(directory, { recursive: true, force: true });
  }
});
