// Minimal static server for the campaign harness.
//
// The harness must be served from the repository root so that its
// `/packages/...` imports resolve to the real workspace packages, including the
// `.wasm` binary, which needs the `application/wasm` content type to stream-
// compile. Keeping this in-process means a run is one command with no external
// dependency on python3 or a global CLI.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    // Strip the query string, then normalize away any `..` segments before
    // joining, so a crafted path cannot escape the repository root.
    const requested = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
    const filePath = join(ROOT, requested);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[extname(filePath)] ?? "application/octet-stream",
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address();
      resolvePromise({
        url: `http://127.0.0.1:${bound}/benchmarks/campaign/site/index.html`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
