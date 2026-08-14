/**
 * The backend kernel — the single seam through which every algorithm crosses
 * into WASM. One `defineKernel(...)` owns load · marshal · dispatch · fallback;
 * algorithms declare only their four adapters.
 *
 * This replaces the per-package `loadWasm` trampolines and the hand-rolled
 * `Array.from` + dispatch logic that used to be copied across seven packages.
 */

/** Effective backend choice consumed by the kernel. */
export type KernelBackend = "auto" | "wasm" | "js";

/**
 * A loader returns the loaded WASM module (after running its init), or `null`
 * if WASM is unavailable / failed to load. `loaded` reports whether the module
 * is currently resident (used by tests to assert which path ran).
 */
export interface WasmLoader {
  load(): Promise<unknown | null>;
  readonly loaded: boolean;
  /**
   * The resident module if `loaded`, else `null` — a synchronous read of what
   * `load()` already resolved. For callers that must pick a backend inside a
   * synchronous constructor (e.g. a stateful sketch class) and therefore
   * cannot `await load()`: they get WASM if it's already resident, JS
   * otherwise, for that instance's whole lifetime. `load()`/`await` first if
   * you want to force the WASM path rather than opportunistically take it.
   */
  readonly moduleSync: unknown | null;
}

/**
 * Build a typed, caching WASM loader keyed by module name. The dynamic import
 * itself is supplied by the calling package via `importer`, so the relative
 * `../wasm/<module>.js` specifier resolves against the package's own `dist/`
 * rather than core's. The loader owns: importing once, running the bindgen
 * `default()` init, caching the module, and returning `null` on any failure.
 *
 * A single loader instance per module is the rule — the kernel is its only
 * caller, replacing the six copies of this trampoline.
 */
/**
 * Test seam: pre-initialized modules keyed by `wasmModuleName`. The dynamic
 * `import()` transport that loaders use cannot resolve wasm-bindgen's
 * `import.meta`-relative fetch under Node/Vitest, so parity tests initialize
 * the real module from disk bytes and register it here — substituting only the
 * transport while marshal → dispatch → unmarshal stay the production code
 * paths. Empty in production.
 */
const injectedModules = new Map<string, unknown>();

/** Register (or clear, with `null`) a pre-initialized WASM module for a
 * loader name. Test-only; see `injectedModules`. */
export function injectWasmModuleForTesting(moduleName: string, mod: unknown | null): void {
  if (mod === null) injectedModules.delete(moduleName);
  else injectedModules.set(moduleName, mod);
}

export function createWasmLoader(moduleName: string, importer: () => Promise<any>): WasmLoader {
  let mod: unknown | null = null;
  let attempted = false;
  let inflight: Promise<unknown | null> | null = null;

  async function doLoad(): Promise<unknown | null> {
    try {
      const m: any = await importer();
      if (m && typeof m.default === "function") {
        await m.default();
      }
      mod = m ?? null;
      return mod;
    } catch {
      mod = null;
      return null;
    }
  }

  return {
    async load() {
      const injected = injectedModules.get(moduleName);
      if (injected) return injected;
      if (mod) return mod;
      if (attempted && !inflight) return mod;
      if (!inflight) {
        attempted = true;
        inflight = doLoad().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    get loaded() {
      return injectedModules.has(moduleName) || mod !== null;
    },
    get moduleSync() {
      return injectedModules.get(moduleName) ?? mod;
    },
  };
}

/**
 * Declarative description of one algorithm's WASM/JS dispatch.
 *
 * - `Args`   — the tuple of inputs the public function receives.
 * - `Out`    — the unmarshalled result returned to callers.
 * - `WasmIn` — what `marshal` produces and `wasmFn` consumes.
 * - `WasmOut`— what `wasmFn` returns and `unmarshal` consumes.
 */
export interface KernelSpec<Args extends unknown[], Out, WasmIn extends unknown[], WasmOut> {
  /** Stable cache key / module name for the WASM binding. */
  wasmModuleName: string;
  /** Calls the wasm-bindgen export with already-marshalled inputs. */
  wasmFn: (mod: any, ...input: WasmIn) => WasmOut;
  /** Pure, synchronous JS implementation. This is the kernel's JS adapter. */
  jsFallback: (...args: Args) => Out;
  /** Marshal public args into the representation the WASM boundary wants. */
  marshal: (...args: Args) => WasmIn;
  /** Unmarshal the WASM result back into the public `Out` shape. */
  unmarshal: (raw: WasmOut, ...args: Args) => Out;
  /**
   * The WASM loader. Defaults to a real loader built from `createWasmLoader`;
   * tests inject a stub to exercise dispatch without a real binary.
   */
  loader?: WasmLoader;
  /**
   * `'auto'` runs the JS core below this input size (boundary-crossing
   * overhead is not worth it for small inputs). Default: 1000.
   */
  autoThreshold?: number;
  /** Derives the input size used by the `'auto'` threshold from the args. */
  sizeOf?: (...args: Args) => number;
}

/** Options accepted by every kernel-wrapped public function. */
export interface KernelCallOptions {
  /**
   * `'auto'` (default) consults the size threshold and WASM availability;
   * `'wasm'` forces the WASM path (falling back to JS only if the module is
   * genuinely absent); `'js'` forces the pure JS core.
   */
  backend?: KernelBackend;
}

/** The default size below which `'auto'` prefers the JS core. */
export const DEFAULT_AUTO_THRESHOLD = 1000;

/**
 * A kernel: an async callable that owns the entire dispatch dance. Also exposes
 * `.core` — the synchronous pure-JS adapter — so the MCP server (and any other
 * synchronous caller) can import the exact same implementation the async shell
 * uses, instead of reimplementing it.
 */
export interface Kernel<Args extends unknown[], Out> {
  (...argsAndOpts: [...Args, KernelCallOptions?]): Promise<Out>;
  /** The pure, synchronous JS core. */
  core(...args: Args): Out;
  /**
   * Same dispatch as calling the kernel directly, but also reports which
   * backend actually ran — for callers that must tell a caller-supplied
   * `backend` choice apart from what really executed (e.g. the MCP server
   * echoing `backend_used` back to an agent), instead of assuming the request
   * was honoured.
   */
  withBackend(
    ...argsAndOpts: [...Args, KernelCallOptions?]
  ): Promise<{ result: Out; backend: "wasm" | "js" }>;
}

/**
 * Produce a kernel from a declarative spec. The returned callable:
 *   1. resolves the effective backend (`auto` | `wasm` | `js`),
 *   2. for `auto`, runs the JS core when the input is below the size threshold,
 *   3. lazily loads WASM (once) and, on success, marshals → `wasmFn` →
 *      unmarshal,
 *   4. falls back to the JS core whenever WASM is unavailable.
 */
export function defineKernel<Args extends unknown[], Out, WasmIn extends unknown[], WasmOut>(
  spec: KernelSpec<Args, Out, WasmIn, WasmOut>,
): Kernel<Args, Out> {
  const autoThreshold = spec.autoThreshold ?? DEFAULT_AUTO_THRESHOLD;

  function core(...args: Args): Out {
    return spec.jsFallback(...args);
  }

  async function runWithBackend(
    ...argsAndOpts: [...Args, KernelCallOptions?]
  ): Promise<{ result: Out; backend: "wasm" | "js" }> {
    let opts: KernelCallOptions | undefined;
    const last = argsAndOpts[argsAndOpts.length - 1];
    let args: Args;
    if (last !== null && typeof last === "object" && "backend" in (last as object)) {
      opts = last as KernelCallOptions;
      args = argsAndOpts.slice(0, -1) as unknown as Args;
    } else {
      args = argsAndOpts as unknown as Args;
    }

    const backend: KernelBackend = opts?.backend ?? "auto";

    if (backend === "js") {
      return { result: core(...args), backend: "js" };
    }

    if (backend === "auto" && spec.sizeOf) {
      const size = spec.sizeOf(...args);
      if (size < autoThreshold) {
        return { result: core(...args), backend: "js" };
      }
    }

    // backend is 'wasm' or 'auto'-above-threshold: try WASM, fall back to JS.
    if (spec.loader) {
      const mod = await spec.loader.load();
      if (mod) {
        const input = spec.marshal(...args);
        const raw = spec.wasmFn(mod as any, ...input);
        return { result: spec.unmarshal(raw, ...args), backend: "wasm" };
      }
    }
    return { result: core(...args), backend: "js" };
  }

  async function run(...argsAndOpts: [...Args, KernelCallOptions?]): Promise<Out> {
    return (await runWithBackend(...argsAndOpts)).result;
  }

  const kernel = run as Kernel<Args, Out>;
  kernel.core = core;
  kernel.withBackend = runWithBackend;
  return kernel;
}
