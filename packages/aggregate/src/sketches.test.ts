import { describe, test, expect, beforeAll } from "vitest";
import { loadWasmForParity, parityMode, injectWasmModuleForTesting } from "@vizcrush/core/parity";
import { DDSketch, KllSketch, HyperLogLog, CountMinSketch } from "./index.js";
import { createDDSketchImpl } from "./sketch-adapters.js";

// Load the REAL wasm-bindgen module from disk (Node can't run bindgen's
// import.meta fetch). It is NOT registered as the loaders' transport yet —
// that happens in the "sketch WASM dispatch" beforeAll below, so the
// JS-backend describes keep constructing pure-JS sketches. Missing wasm fails
// under VIZCRUSH_REQUIRE_WASM (CI), and skips the dispatch block loudly
// otherwise.
const wasm = await loadWasmForParity(import.meta.url, "vizcrush_aggregate");
const mode = parityMode(wasm, "vizcrush_aggregate");
const jsParityKll = new KllSketch(200);
const jsParityHll = new HyperLogLog(14);
const jsParityCms = new CountMinSketch(1024, 5);

// These describes run before the "WASM dispatch" block below injects the
// module, so every sketch constructed here uses the JS core — the same
// assertion as the WASM-backed tests further down, letting the two blocks
// double as a loose JS/WASM parity check without a dedicated harness.

describe("DDSketch (JS backend)", () => {
  test("quantile estimates are close to exact for uniform data", () => {
    const sketch = new DDSketch(0.01);
    for (let i = 1; i <= 1000; i++) sketch.add(i);
    expect(sketch.count).toBe(1000);
    expect(sketch.min).toBe(1);
    expect(sketch.max).toBe(1000);
    // 1% relative accuracy: median of 1..1000 is 500, allow generous slack.
    expect(sketch.quantile(0.5)).toBeGreaterThan(480);
    expect(sketch.quantile(0.5)).toBeLessThan(520);
  });

  test("addBatch matches repeated add", () => {
    const a = new DDSketch(0.01);
    const b = new DDSketch(0.01);
    const values = [5, 10, 15, 20, 25];
    for (const v of values) a.add(v);
    b.addBatch(values);
    expect(b.count).toBe(a.count);
    expect(b.quantile(0.5)).toBe(a.quantile(0.5));
  });
});

describe("KllSketch (JS backend)", () => {
  test("quantile and rank agree on uniform data", () => {
    const sketch = new KllSketch(200);
    for (let i = 1; i <= 1000; i++) sketch.add(i);
    expect(sketch.count).toBe(1000);
    expect(sketch.quantile(0.5)).toBeGreaterThan(400);
    expect(sketch.quantile(0.5)).toBeLessThan(600);
    expect(sketch.rank(500)).toBeGreaterThan(0.35);
    expect(sketch.rank(500)).toBeLessThan(0.65);
  });
});

describe("HyperLogLog (JS backend)", () => {
  test("estimates cardinality within expected error", () => {
    const hll = new HyperLogLog(14);
    for (let i = 0; i < 10_000; i++) hll.add(i);
    const est = hll.estimate();
    // stdError at precision 14 is ~0.8%; allow a generous 10% band.
    expect(est).toBeGreaterThan(9_000);
    expect(est).toBeLessThan(11_000);
  });

  test("duplicate values don't inflate the estimate", () => {
    const hll = new HyperLogLog(14);
    for (let i = 0; i < 1000; i++) hll.add(42);
    expect(hll.estimate()).toBeLessThan(10);
  });
});

describe("CountMinSketch (JS backend)", () => {
  test("estimate is never below the true count (one-sided error)", () => {
    const cms = new CountMinSketch(2048, 5);
    for (let i = 0; i < 50; i++) cms.add(7);
    expect(cms.estimate(7)).toBeGreaterThanOrEqual(50);
  });

  test("addWithCount contributes the given weight", () => {
    const cms = new CountMinSketch(2048, 5);
    cms.addWithCount(3, 100);
    expect(cms.estimate(3)).toBeGreaterThanOrEqual(100);
  });
});

describe.runIf(mode === "run")("sketch WASM dispatch", () => {
  beforeAll(() => {
    // Register the disk-initialized module as the loaders' transport; every
    // sketch constructed afterward in this describe picks up
    // `loader.moduleSync` (shared with stats()/percentile()) and dispatches
    // to the real WASM adapter for its whole lifetime. Each test asserts
    // The adapter-level comparisons below exercise the real WASM objects
    // without reaching through the public sketches' private state.
    injectWasmModuleForTesting("vizcrush_aggregate", wasm);
  });

  test("DDSketch uses the WASM adapter once the module is resident", () => {
    const js = createDDSketchImpl(null, 0.01);
    const wasmImpl = createDDSketchImpl(wasm, 0.01);
    expect(js.backend).toBe("js");
    expect(wasmImpl.backend).toBe("wasm");
    const s = new DDSketch(0.01);
    for (let i = 1; i <= 100; i++) s.add(i);
    expect(s.count).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.quantile(0.5)).toBeGreaterThan(0);

    const values = Float64Array.from({ length: 100 }, (_, index) => index + 1);
    js.addBatch(values);
    wasmImpl.addBatch(values);
    expect(wasmImpl.count).toBe(js.count);
    expect(wasmImpl.min).toBe(js.min);
    expect(wasmImpl.max).toBe(js.max);
    expect(wasmImpl.quantile(0.5)).toBeCloseTo(js.quantile(0.5), 10);
  });

  test("KllSketch uses the WASM adapter once the module is resident", () => {
    const s = new KllSketch(200);
    for (let i = 1; i <= 100; i++) {
      s.add(i);
      jsParityKll.add(i);
    }
    expect(s.count).toBe(100);
    expect(s.quantile(0.5)).toBeGreaterThan(0);
    expect(s.count).toBe(jsParityKll.count);
    expect(s.min).toBe(jsParityKll.min);
    expect(s.max).toBe(jsParityKll.max);
  });

  test("HyperLogLog uses the WASM adapter once the module is resident", () => {
    const h = new HyperLogLog(14);
    for (let i = 0; i < 1000; i++) {
      h.add(i);
      jsParityHll.add(i);
    }
    const est = h.estimate();
    expect(est).toBeGreaterThan(900);
    expect(est).toBeLessThan(1100);
    expect(Math.abs(est - jsParityHll.estimate()) / jsParityHll.estimate()).toBeLessThan(0.03);
  });

  test("CountMinSketch uses the WASM adapter once the module is resident", () => {
    const c = new CountMinSketch(1024, 5);
    c.addWithCount(42, 10);
    jsParityCms.addWithCount(42, 10);
    expect(c.estimate(42)).toBeGreaterThanOrEqual(10);
    expect(c.estimate(42)).toBe(jsParityCms.estimate(42));
  });

  test("CountMinSketch.addWithCount accepts a fractional count on the WASM adapter", () => {
    const c = new CountMinSketch(1024, 5);
    expect(() => c.addWithCount(7, 2.5)).not.toThrow();
    expect(c.estimate(7)).toBeGreaterThanOrEqual(2);
  });
});
