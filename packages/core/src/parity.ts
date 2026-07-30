/**
 * Shared parity-harness infrastructure. One mechanism, reused by every
 * algorithm package's parity test, that asserts the JS adapter and the REAL
 * WASM adapter return equal results on identical input. This is the test that
 * finally exercises the WASM path and would catch a Rust → wasm-bindgen
 * regression before release.
 *
 * The wasm-bindgen `--target web` build fetches its `.wasm` via `import.meta`,
 * which does not work under Node/Vitest. `loadWasmForParity` side-steps that by
 * reading the `_bg.wasm` bytes from disk and handing them to the bindgen init.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load a package's real wasm-bindgen module for parity testing under Node.
 *
 * @param jsUrl  `import.meta.url` of the parity test (used to resolve the
 *               package's `wasm/` directory relative to `src/`).
 * @param relWasmDir path from the test file's dir to the `wasm/` dir
 *               (default `"../wasm"`).
 * @param moduleBase the bindgen output base name, e.g. `"vizcrush_downsample"`.
 */
export async function loadWasmForParity(
  jsUrl: string,
  moduleBase: string,
  relWasmDir = "../wasm",
): Promise<any | null> {
  try {
    const here = dirname(fileURLToPath(jsUrl));
    const wasmDir = join(here, relWasmDir);
    const jsPath = join(wasmDir, `${moduleBase}.js`);
    const bgPath = join(wasmDir, `${moduleBase}_bg.wasm`);
    const mod: any = await import(/* @vite-ignore */ jsPath);
    if (typeof mod.default === "function") {
      const bytes = readFileSync(bgPath);
      await mod.default({ module_or_path: bytes });
    }
    return mod;
  } catch {
    return null;
  }
}

/** Default numeric tolerance for float parity comparisons. */
export const PARITY_EPSILON = 1e-9;

/** Assert two number sequences are equal within `epsilon`. */
export function expectFloatArraysClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  epsilon: number,
  label: string,
): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: length mismatch — js=${expected.length} wasm=${actual.length}`);
  }
  for (let i = 0; i < actual.length; i++) {
    const d = Math.abs(actual[i] - expected[i]);
    if (d > epsilon || Number.isNaN(d)) {
      throw new Error(
        `${label}: value mismatch at [${i}] — js=${expected[i]} wasm=${actual[i]} (Δ=${d})`,
      );
    }
  }
}
