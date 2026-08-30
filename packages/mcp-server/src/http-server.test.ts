import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, test } from "vitest";
import { createServer } from "./index.js";
import { isLoopbackHost, startHttpServer } from "./http-server.js";

describe("MCP HTTP transport", () => {
  test("listens on loopback unless a host is explicitly configured", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      port: 0,
      version: "test",
    });

    try {
      expect(running.host).toBe("127.0.0.1");
      expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    } finally {
      await running.close();
    }
  });

  test("refuses a non-loopback listener without authentication", async () => {
    await expect(
      startHttpServer({
        createMcpServer: createServer,
        host: "0.0.0.0",
        port: 0,
        version: "test",
      }),
    ).rejects.toThrow("requires VIZCRUSH_MCP_TOKEN");
  });

  test("does not treat a hostname beginning with 127 as a loopback address", () => {
    expect(isLoopbackHost("127.192.168.1.5.nip.io")).toBe(false);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.255.255.254")).toBe(true);
  });

  test("rejects a forged Host header on a tokenless loopback listener", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      port: 0,
      version: "test",
    });

    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(running.url, {
          method: "POST",
          headers: { host: `attacker.example:${running.port}` },
        });
        req.on("response", (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolve(incoming.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end("{}");
      });

      expect(status).toBe(403);
    } finally {
      await running.close();
    }
  });

  test("rejects an unconfigured Origin on a tokenless loopback listener", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      port: 0,
      version: "test",
    });

    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(new URL("/health", running.url), {
          headers: { origin: "https://attacker.example" },
        });
        req.on("response", (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolve(incoming.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });

      expect(status).toBe(403);
    } finally {
      await running.close();
    }
  });

  test("allows configured CORS preflight without a bearer token", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      corsOrigin: "https://app.example.com",
      port: 0,
      token: "secret",
      version: "test",
    });

    try {
      const response = await new Promise<{
        allowedHeaders?: string;
        origin?: string;
        status: number;
      }>((resolve, reject) => {
        const req = request(running.url, {
          method: "OPTIONS",
          headers: {
            origin: "https://app.example.com",
            "access-control-request-headers":
              "content-type, authorization, mcp-protocol-version, mcp-session-id",
          },
        });
        req.on("response", (incoming) => {
          incoming.resume();
          incoming.on("end", () =>
            resolve({
              allowedHeaders: incoming.headers["access-control-allow-headers"],
              origin: incoming.headers["access-control-allow-origin"],
              status: incoming.statusCode ?? 0,
            }),
          );
        });
        req.on("error", reject);
        req.end();
      });

      expect(response).toEqual({
        allowedHeaders: "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
        origin: "https://app.example.com",
        status: 204,
      });
    } finally {
      await running.close();
    }
  });

  test("allows an explicitly configured Origin on a tokenless loopback listener", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      corsOrigin: "https://app.example.com",
      port: 0,
      version: "test",
    });

    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(running.url, {
          method: "OPTIONS",
          headers: { origin: "https://app.example.com" },
        });
        req.on("response", (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolve(incoming.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });

      expect(status).toBe(204);
    } finally {
      await running.close();
    }
  });

  test("supports initialize and a subsequent request through the SDK HTTP client", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      port: 0,
      version: "test",
    });
    const client = new Client({ name: "http-test-client", version: "0.0.0" });

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(running.url)));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("vizcrush_lttb");
    } finally {
      await client.close();
      await running.close();
    }
  });

  test("enforces bearer authentication when configured", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      port: 0,
      token: "secret",
      version: "test",
    });

    const healthUrl = new URL("/health", running.url);
    const getStatus = (authorization?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(healthUrl, {
          headers: authorization ? { authorization } : undefined,
        });
        req.on("response", (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolve(incoming.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });

    try {
      await expect(getStatus()).resolves.toBe(401);
      await expect(getStatus("Bearer wrong")).resolves.toBe(401);
      await expect(getStatus("Bearer secret")).resolves.toBe(200);
    } finally {
      await running.close();
    }
  });

  test("rejects a chunked request once actual bytes exceed the body limit", async () => {
    const running = await startHttpServer({
      createMcpServer: createServer,
      maxBodyBytes: 32,
      port: 0,
      version: "test",
    });

    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(running.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
        req.on("response", (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode ?? 0));
        });
        req.on("error", reject);
        req.write('{"jsonrpc":"2.0","method":"tools/call","params":{"padding":"');
        req.end('abcdefghijklmnopqrstuvwxyz"},"id":1}');
      });

      expect(status).toBe(413);
    } finally {
      await running.close();
    }
  });
});
