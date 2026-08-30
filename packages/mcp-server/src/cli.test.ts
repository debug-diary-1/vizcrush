import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("published MCP CLI", () => {
  test.skipIf(process.platform === "win32")(
    "starts when the built package bin is invoked through a symlink",
    async () => {
      const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
      const builtBin = resolve(packageRoot, packageJson.bin["vizcrush-mcp-server"]);
      const directory = mkdtempSync(join(tmpdir(), "vizcrush-mcp-cli-"));
      temporaryDirectories.push(directory);
      const linkedBin = join(directory, "vizcrush-mcp-server");
      symlinkSync(builtBin, linkedBin);

      const startup = await new Promise<string>((resolveStartup, rejectStartup) => {
        const child = spawn(process.execPath, [linkedBin, "--transport", "http", "--port", "0"], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          rejectStartup(new Error(`CLI did not start; stderr: ${stderr}`));
        }, 5_000);

        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
          if (!settled && stderr.includes("vizcrush MCP server running at")) {
            settled = true;
            clearTimeout(timeout);
            child.kill();
            resolveStartup(stderr);
          }
        });
        child.on("error", rejectStartup);
        child.on("exit", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          rejectStartup(new Error(`CLI exited with ${code}; stderr: ${stderr}`));
        });
      });

      expect(startup).toContain("http://127.0.0.1:");
    },
  );
});
