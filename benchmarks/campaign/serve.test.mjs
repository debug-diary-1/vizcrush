import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "./serve.mjs";

let server;
let origin;

beforeAll(async () => {
  server = await startServer();
  origin = new URL(server.url).origin;
});

afterAll(async () => {
  await server.close();
});

describe("startServer", () => {
  it("serves the harness page with the html content type", async () => {
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("__ready");
  });

  it("serves the shared protocol module as JavaScript", async () => {
    const res = await fetch(`${origin}/benchmarks/campaign/protocol.mjs`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toContain("assertParity");
  });

  it("serves .wasm with the streaming-compile content type", async () => {
    const wasmPath = "/packages/downsample/wasm/vizcrush_downsample_bg.wasm";
    if (!existsSync(fileURLToPath(new URL(`../..${wasmPath}`, import.meta.url)))) return;
    const res = await fetch(`${origin}${wasmPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/wasm");
    await res.arrayBuffer();
  });

  it("returns 404 for missing files and directories", async () => {
    expect((await fetch(`${origin}/no-such-file.js`)).status).toBe(404);
    expect((await fetch(`${origin}/benchmarks`)).status).toBe(404);
  });

  it("does not serve paths outside the repository root", async () => {
    for (const probe of [
      "/../../../../etc/passwd",
      "/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      "/benchmarks/../../etc/passwd",
    ]) {
      const res = await fetch(`${origin}${probe}`);
      expect([403, 404]).toContain(res.status);
    }
  });
});
