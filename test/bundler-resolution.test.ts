/**
 * Guards the one regression the rest of the suite structurally cannot see.
 *
 * Every other test runs in Node, where the packages are read straight out of
 * their own `dist/` and a relative `../wasm/...` specifier resolves correctly.
 * A browser app that *bundles* vizcrush is a different world: the module is
 * inlined into an application chunk, and anything the bundler could not resolve
 * at build time is left as a runtime path relative to that chunk instead.
 *
 * That is exactly how the WASM path broke once. The loader hid its specifier
 * from bundlers on purpose, so no `.wasm` was ever emitted, the runtime import
 * 404'd, and `createWasmLoader` swallowed the failure by design. Consumers got
 * the JS core with no error, no warning, and 438 passing tests.
 *
 * So this builds a real app with a real bundler and asserts on what came out.
 * It deliberately checks the *artifacts* rather than running the app: the
 * failure mode is "the binary was never emitted", which is visible in the build
 * output and needs no browser to detect.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { build } from "vite";
import { readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "bundler-fixture");
const outDir = path.join(fixture, "dist");

/** Every file the bundler emitted, relative to `outDir`. */
async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

let files: string[] = [];
let jsSource = "";

describe("WASM survives bundling", () => {
  beforeAll(async () => {
    // The fixture imports the workspace package, so the packages have to be
    // built and the wasm generated. `pnpm build` does both; CI runs it before
    // vitest. Fail with a useful message rather than a confusing build error.
    const wasmDir = path.join(here, "..", "packages", "downsample", "wasm");
    if (!existsSync(wasmDir)) {
      throw new Error(
        `${wasmDir} is missing. Run 'pnpm build' (or 'pnpm build:wasm') before this test: ` +
          "it asserts on what a bundler emits, which requires the wasm to exist.",
      );
    }

    await rm(outDir, { recursive: true, force: true });
    await build({
      root: fixture,
      logLevel: "silent",
      build: { outDir: "dist", emptyOutDir: true, target: "esnext" },
    });

    files = await walk(outDir);
    const js = files.filter((f) => f.endsWith(".js"));
    jsSource = (await Promise.all(js.map((f) => readFile(path.join(outDir, f), "utf8")))).join(
      "\n",
    );
  }, 120_000);

  it("emits the wasm binary as an asset", () => {
    const wasm = files.filter((f) => f.endsWith(".wasm"));
    expect(
      wasm,
      `no .wasm in the bundle output. The bundler could not follow the loader's ` +
        `specifier, so the WASM path will 404 at runtime and silently fall back ` +
        `to the JS core. Emitted files: ${files.join(", ")}`,
    ).not.toHaveLength(0);
  });

  it("emits the wasm-bindgen glue as a chunk", () => {
    const glue = files.filter((f) => /vizcrush_downsample.*\.js$/.test(f));
    expect(
      glue,
      `the wasm-bindgen glue was not emitted as a module. Without it the ` +
        `binary cannot be instantiated. Emitted files: ${files.join(", ")}`,
    ).not.toHaveLength(0);
  });

  it("keeps the glue out of the entry chunk, so wasm stays lazily loaded", () => {
    const entry = files.find((f) => /assets\/index-.*\.js$/.test(f));
    expect(entry, `no entry chunk found in ${files.join(", ")}`).toBeDefined();
    // A separate chunk is the whole point: callers who never touch the WASM
    // path should not pay for it in the initial download.
    const glue = files.filter((f) => /vizcrush_downsample.*\.js$/.test(f));
    expect(glue.some((g) => g !== entry)).toBe(true);
  });

  it("does not hide the specifier from the bundler", () => {
    // The precise shape of the original bug: a computed specifier behind
    // `new Function`, which no bundler can follow.
    expect(
      /new Function\(\s*["']p["']\s*,\s*["']return import\(p\)["']/.test(jsSource),
      "found a bundler-opaque dynamic import in the output. That is the exact " +
        "construct that caused WASM to silently fall back to the JS core.",
    ).toBe(false);
  });

  it("does not leave an unresolved ../wasm/ runtime path", () => {
    // `../wasm/x.js` from a chunk in assets/ resolves to a directory nothing
    // emits. Seeing it in the output means the specifier was not rewritten.
    expect(
      jsSource.includes('"../wasm/') || jsSource.includes("'../wasm/"),
      "output still contains a literal ../wasm/ import path, which resolves " +
        "against the emitted chunk rather than the package directory.",
    ).toBe(false);
  });
});
