import { describe, test, expect } from "vitest";
import { defineKernel, createWasmLoader } from "./kernel.js";
import type { WasmLoader } from "./kernel.js";

// A stub loader stands in for a real WASM binary so we can test dispatch
// through the kernel's public interface without booting wasm.
function stubLoader(mod: unknown | null): WasmLoader {
  let loaded = false;
  return {
    async load() {
      if (mod === null) return null;
      loaded = true;
      return mod;
    },
    get loaded() {
      return loaded;
    },
    get moduleSync() {
      return loaded ? mod : null;
    },
  };
}

// A tiny algorithm: double each element. WASM "implementation" adds a marker so
// we can observe which path actually ran.
type Args = [Float64Array];
function makeKernel(loader: WasmLoader, autoThreshold = 1000) {
  return defineKernel<Args, Float64Array, [Float64Array], Float64Array>({
    wasmModuleName: "stub",
    loader,
    wasmFn: (mod: any, arr) => mod.double(arr) as Float64Array,
    jsFallback: (arr) => arr.map((v) => v * 2),
    marshal: (arr) => [arr],
    unmarshal: (raw) => raw,
    sizeOf: (arr) => arr.length,
    autoThreshold,
  });
}

const wasmMod = {
  double: (arr: Float64Array) => {
    const out = new Float64Array(arr.length);
    // marker: wasm path adds +1000 on top of doubling so it is distinguishable.
    for (let i = 0; i < arr.length; i++) out[i] = arr[i] * 2 + 1000;
    return out;
  },
};

describe("defineKernel dispatch", () => {
  test("load succeeds → WASM path is taken", async () => {
    const k = makeKernel(stubLoader(wasmMod), 0);
    const out = await k(new Float64Array([1, 2, 3]));
    // WASM marker present.
    expect(Array.from(out)).toEqual([1002, 1004, 1006]);
  });

  test("load fails → JS core runs and returns a correct result", async () => {
    const k = makeKernel(stubLoader(null), 0);
    const out = await k(new Float64Array([1, 2, 3]));
    expect(Array.from(out)).toEqual([2, 4, 6]);
  });

  test("backend: 'js' forces the core even when WASM is available", async () => {
    const k = makeKernel(stubLoader(wasmMod), 0);
    const out = await k(new Float64Array([1, 2, 3]), { backend: "js" });
    expect(Array.from(out)).toEqual([2, 4, 6]);
  });

  test("backend: 'wasm' forces the WASM path", async () => {
    const k = makeKernel(stubLoader(wasmMod), 1_000_000);
    // Even though the input is below the auto threshold, 'wasm' forces WASM.
    const out = await k(new Float64Array([1, 2, 3]), { backend: "wasm" });
    expect(Array.from(out)).toEqual([1002, 1004, 1006]);
  });

  test("backend: 'wasm' falls back to JS when the module is genuinely absent", async () => {
    const k = makeKernel(stubLoader(null), 0);
    const out = await k(new Float64Array([1, 2, 3]), { backend: "wasm" });
    expect(Array.from(out)).toEqual([2, 4, 6]);
  });

  test("'auto' honours the size threshold: below → JS core", async () => {
    const k = makeKernel(stubLoader(wasmMod), 1_000_000);
    const out = await k(new Float64Array([1, 2, 3]));
    // Below threshold: JS path, no wasm marker.
    expect(Array.from(out)).toEqual([2, 4, 6]);
  });

  test("'auto' honours the size threshold: at/above → WASM path", async () => {
    const k = makeKernel(stubLoader(wasmMod), 3);
    const out = await k(new Float64Array([1, 2, 3]));
    expect(Array.from(out)).toEqual([1002, 1004, 1006]);
  });

  test("marshalling round-trips typed arrays (in and out)", async () => {
    const k = makeKernel(stubLoader(wasmMod), 0);
    const out = await k(new Float64Array([5]));
    expect(out).toBeInstanceOf(Float64Array);
  });

  test(".core exposes the synchronous pure JS adapter", () => {
    const k = makeKernel(stubLoader(wasmMod), 0);
    const out = k.core(new Float64Array([1, 2, 3]));
    expect(out).toBeInstanceOf(Float64Array);
    expect(Array.from(out)).toEqual([2, 4, 6]);
  });

  test(".withBackend reports 'wasm' when the WASM path actually ran", async () => {
    const k = makeKernel(stubLoader(wasmMod), 0);
    const { result, backend } = await k.withBackend(new Float64Array([1, 2, 3]), {
      backend: "wasm",
    });
    expect(backend).toBe("wasm");
    expect(Array.from(result)).toEqual([1002, 1004, 1006]);
  });

  test(".withBackend reports 'js' when 'wasm' was requested but the module is absent", async () => {
    const k = makeKernel(stubLoader(null), 0);
    const { result, backend } = await k.withBackend(new Float64Array([1, 2, 3]), {
      backend: "wasm",
    });
    expect(backend).toBe("js");
    expect(Array.from(result)).toEqual([2, 4, 6]);
  });

  test(".withBackend reports 'js' when 'js' was forced despite WASM being available", async () => {
    const k = makeKernel(stubLoader(wasmMod), 0);
    const { backend } = await k.withBackend(new Float64Array([1, 2, 3]), { backend: "js" });
    expect(backend).toBe("js");
  });
});

describe("createWasmLoader", () => {
  test("returns null and stays unloaded when the import throws", async () => {
    const loader = createWasmLoader("missing", () => {
      throw new Error("no such module");
    });
    expect(await loader.load()).toBe(null);
    expect(loader.loaded).toBe(false);
  });

  test("caches the module and runs default() init once", async () => {
    let initCalls = 0;
    const fakeMod = {
      default: async () => {
        initCalls++;
      },
      value: 42,
    };
    const loader = createWasmLoader("fake", async () => fakeMod);
    const a = await loader.load();
    const b = await loader.load();
    expect(a).toBe(fakeMod);
    expect(b).toBe(fakeMod);
    expect(loader.loaded).toBe(true);
    expect(initCalls).toBe(1);
  });

  test("concurrent loads share one in-flight import", async () => {
    let imports = 0;
    const loader = createWasmLoader("once", async () => {
      imports++;
      return { default: async () => {} };
    });
    await Promise.all([loader.load(), loader.load(), loader.load()]);
    expect(imports).toBe(1);
  });

  test("moduleSync is null before load() resolves, then the resident module", async () => {
    const fakeMod = { value: 42 };
    const loader = createWasmLoader("sync-check", async () => fakeMod);
    expect(loader.moduleSync).toBe(null);
    await loader.load();
    expect(loader.moduleSync).toBe(fakeMod);
  });

  test("moduleSync stays null when the import fails", async () => {
    const loader = createWasmLoader("sync-check-fail", () => {
      throw new Error("no such module");
    });
    await loader.load();
    expect(loader.moduleSync).toBe(null);
  });
});
