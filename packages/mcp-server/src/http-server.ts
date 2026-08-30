import { timingSafeEqual } from "node:crypto";
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { isIP, type AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3847;
const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface HttpServerOptions {
  createMcpServer: () => McpServer;
  version: string;
  host?: string;
  port?: number;
  token?: string;
  corsOrigin?: string;
  maxBodyBytes?: number;
}

export interface RunningHttpServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private maxRequests = 100,
    private windowMs = 60_000,
    private maxTrackedIps = 10_000,
  ) {}

  check(ip: string): boolean {
    const now = Date.now();
    const current = this.windows.get(ip);
    if (!current || now > current.resetAt) {
      this.deleteExpired(now);
      if (!this.windows.has(ip) && this.windows.size >= this.maxTrackedIps) return false;
      this.windows.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    current.count++;
    return current.count <= this.maxRequests;
  }

  private deleteExpired(now: number): void {
    for (const [ip, window] of this.windows) {
      if (now > window.resetAt) this.windows.delete(ip);
    }
  }
}

type BodyResult =
  | { status: "ok"; value: unknown }
  | { status: "too-large" }
  | { status: "invalid" };

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    req.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        chunks.length = 0;
        if (!settled) {
          settled = true;
          resolve({ status: "too-large" });
        }
        return;
      }
      if (!settled) chunks.push(buffer);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve({ status: "ok", value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        resolve({ status: "invalid" });
      }
    });

    req.on("error", () => {
      if (!settled) {
        settled = true;
        resolve({ status: "invalid" });
      }
    });
  });
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "localhost") return true;
  if (isIP(normalized) === 4) return normalized.split(".")[0] === "127";
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
}

function formatHostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function tokenlessRequestIsAllowed(
  req: IncomingMessage,
  host: string,
  port: number,
  corsOrigin: string | undefined,
): boolean {
  const allowedHosts = new Set([
    `${formatHostForUrl(host)}:${port}`.toLowerCase(),
    `localhost:${port}`,
  ]);
  const requestHost = req.headers.host?.toLowerCase();
  if (!requestHost || !allowedHosts.has(requestHost)) return false;

  const requestOrigin = req.headers.origin;
  return !requestOrigin || requestOrigin === corsOrigin;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function respond(
  res: ServerResponse,
  status: number,
  body: string,
  contentType = "text/plain",
): void {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}

export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const token = options.token;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  let boundPort = port;

  if (!isLoopbackHost(host) && !token) {
    throw new Error("A non-loopback MCP HTTP listener requires VIZCRUSH_MCP_TOKEN.");
  }

  const rateLimiter = new RateLimiter();
  const httpServer = createNodeHttpServer(async (req, res) => {
    const ip = req.socket.remoteAddress || "unknown";
    if (!rateLimiter.check(ip)) {
      respond(res, 429, "Too Many Requests");
      return;
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (options.corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", options.corsOrigin);
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id",
      );
    }

    if (!token && !tokenlessRequestIsAllowed(req, host, boundPort, options.corsOrigin)) {
      respond(res, 403, "Forbidden");
      return;
    }

    if (req.method === "OPTIONS") {
      if (!options.corsOrigin) {
        respond(res, 403, "Cross-origin requests are disabled");
      } else {
        res.writeHead(204);
        res.end();
      }
      return;
    }

    if (token && !tokenMatches(req.headers.authorization, token)) {
      respond(res, 401, "Unauthorized");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      respond(
        res,
        200,
        JSON.stringify({ status: "ok", version: options.version }),
        "application/json",
      );
      return;
    }
    if (url.pathname !== "/mcp") {
      respond(res, 404, "Not found");
      return;
    }
    if (req.method !== "POST") {
      respond(res, 405, "Method Not Allowed");
      return;
    }

    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      respond(res, 413, "Payload Too Large");
      req.resume();
      return;
    }

    const body = await readJsonBody(req, maxBodyBytes);
    if (body.status === "too-large") {
      respond(res, 413, "Payload Too Large");
      return;
    }
    if (body.status === "invalid") {
      respond(res, 400, "Invalid JSON");
      return;
    }

    const mcpServer = options.createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const close = async () => {
      await transport.close();
      await mcpServer.close();
    };
    res.once("close", () => void close());

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body.value);
    } catch (error) {
      console.error("MCP HTTP request failed:", error);
      if (!res.headersSent) respond(res, 500, "Internal Server Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      const address = httpServer.address() as AddressInfo;
      if (!token && !isLoopbackHost(address.address)) {
        httpServer.close(() =>
          reject(new Error("A non-loopback MCP HTTP listener requires VIZCRUSH_MCP_TOKEN.")),
        );
        return;
      }
      resolve();
    });
  });

  const address = httpServer.address() as AddressInfo;
  boundPort = address.port;
  return {
    host,
    port: address.port,
    url: `http://${formatHostForUrl(host)}:${address.port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
