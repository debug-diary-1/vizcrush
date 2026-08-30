#!/usr/bin/env node

import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startHttpServer } from "./http-server.js";
import { createServer } from "./index.js";

const PACKAGE_VERSION: string = createRequire(import.meta.url)("../package.json").version;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isHttp = args.includes("--transport") && args.includes("http");
  const portIndex = args.indexOf("--port");
  const port = portIndex >= 0 ? Number.parseInt(args[portIndex + 1], 10) : 3847;
  const hostIndex = args.indexOf("--host");
  const host = hostIndex >= 0 ? args[hostIndex + 1] : "127.0.0.1";

  if (isHttp) {
    const running = await startHttpServer({
      createMcpServer: createServer,
      version: PACKAGE_VERSION,
      host,
      port,
      token: process.env.VIZCRUSH_MCP_TOKEN,
      corsOrigin: process.env.VIZCRUSH_MCP_CORS_ORIGIN,
    });
    console.error(`vizcrush MCP server running at ${running.url}`);
    return;
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
