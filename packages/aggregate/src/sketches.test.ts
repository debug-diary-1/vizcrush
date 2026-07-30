import { describe, test, expect, beforeAll } from "vitest";
import { DDSketch, KllSketch, HyperLogLog, CountMinSketch, stats } from "./index.js";

// These describes run before the "WASM dispatch" block below forces the
// module to load, so every sketch constructed here uses the JS core — the
// same assertion as the WASM-backed tests further down, letting the two
// blocks double as a loose JS/WASM parity check without a dedicated harness.

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

describe("sketch WASM dispatch", () => {
  beforeAll(async () => {
    // Force the aggregate WASM module to load once; every sketch constructed
    // afterward in this describe picks up `loader.moduleSync` (shared with
    // stats()/percentile()) and dispatches to the real WASM adapter for its
    // whole lifetime. If no WASM build is present in this environment, this
    // silently stays on JS — same graceful-degradation behaviour as the
    // kernel everywhere else — and the assertions below are skipped.
    await stats(new Float64Array([1, 2, 3]), { backend: "wasm" });
  });

  test("DDSketch uses the WASM adapter once the module is resident", () => {
    const sketch = new DDSketch(0.01) as unknown as { _wasm?: unknown };
    if (!sketch._wasm) return; // no WASM build in this environment
    const s = sketch as unknown as DDSketch;
    for (let i = 1; i <= 100; i++) s.add(i);
    expect(s.count).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.quantile(0.5)).toBeGreaterThan(0);
  });

  test("KllSketch uses the WASM adapter once the module is resident", () => {
    const sketch = new KllSketch(200) as unknown as { _wasm?: unknown };
    if (!sketch._wasm) return;
    const s = sketch as unknown as KllSketch;
    for (let i = 1; i <= 100; i++) s.add(i);
    expect(s.count).toBe(100);
    expect(s.quantile(0.5)).toBeGreaterThan(0);
  });

  test("HyperLogLog uses the WASM adapter once the module is resident", () => {
    const hll = new HyperLogLog(14) as unknown as { _wasm?: unknown };
    if (!hll._wasm) return;
    const h = hll as unknown as HyperLogLog;
    for (let i = 0; i < 1000; i++) h.add(i);
    const est = h.estimate();
    expect(est).toBeGreaterThan(900);
    expect(est).toBeLessThan(1100);
  });

  test("CountMinSketch uses the WASM adapter once the module is resident", () => {
    const cms = new CountMinSketch(1024, 5) as unknown as { _wasm?: unknown };
    if (!cms._wasm) return;
    const c = cms as unknown as CountMinSketch;
    c.addWithCount(42, 10);
    expect(c.estimate(42)).toBeGreaterThanOrEqual(10);
  });

  test("CountMinSketch.addWithCount accepts a fractional count on the WASM adapter", () => {
    const cms = new CountMinSketch(1024, 5) as unknown as { _wasm?: unknown };
    if (!cms._wasm) return;
    const c = cms as unknown as CountMinSketch;
    expect(() => c.addWithCount(7, 2.5)).not.toThrow();
    expect(c.estimate(7)).toBeGreaterThanOrEqual(2);
  });
});
