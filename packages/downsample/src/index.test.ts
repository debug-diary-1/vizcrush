import { describe, test, expect } from "vitest";
import * as fc from "fast-check";
import { lttb, lttbSync, minMaxLttb, m4, ltob } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate linearly spaced Float64Arrays for x and a sine wave for y. */
function sineWave(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i;
    y[i] = Math.sin((2 * Math.PI * i) / n);
  }
  return { x, y };
}

/** Generate monotonically increasing x with random-ish y. */
function linearX(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i * 1.5;
    y[i] = Math.random() * 100;
  }
  return { x, y };
}

// LTTB-family functions return exactly `threshold` points (first/last
// preserved). m4 is excluded from this strict shared suite because it genuinely
// returns a variable number of points (first/min/max/last per bucket, deduped)
// — it has its own dedicated tests below.
const asyncFns = [
  { name: "lttb", fn: lttb },
  { name: "minMaxLttb", fn: minMaxLttb },
  { name: "ltob", fn: ltob },
] as const;

// Include lttbSync alongside async functions for shared behavioural tests.
type DownsampleFn = (
  x: Float64Array,
  y: Float64Array,
  threshold: number,
) => Promise<{ x: Float64Array; y: Float64Array }> | { x: Float64Array; y: Float64Array };

const allFns: { name: string; fn: DownsampleFn }[] = [
  ...asyncFns,
  { name: "lttbSync", fn: lttbSync },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.each(allFns)("$name", ({ fn }) => {
  // 1. Basic downsampling — 1000 points to 50
  test("basic downsampling: 1000 points to 50", async () => {
    const { x, y } = sineWave(1000);
    const result = await fn(x, y, 50);

    expect(result.x).toBeInstanceOf(Float64Array);
    expect(result.y).toBeInstanceOf(Float64Array);
    expect(result.x.length).toBe(50);
    expect(result.y.length).toBe(50);

    // First point preserved
    expect(result.x[0]).toBe(x[0]);
    expect(result.y[0]).toBe(y[0]);

    // Last point preserved
    expect(result.x[result.x.length - 1]).toBe(x[x.length - 1]);
    expect(result.y[result.y.length - 1]).toBe(y[y.length - 1]);
  });

  // 2. Threshold >= input length — returns all points unchanged
  test("threshold >= input length returns all points", async () => {
    const { x, y } = sineWave(20);

    const resultExact = await fn(x, y, 20);
    expect(resultExact.x.length).toBe(20);
    expect(resultExact.y.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(resultExact.x[i]).toBe(x[i]);
      expect(resultExact.y[i]).toBe(y[i]);
    }

    const resultOver = await fn(x, y, 100);
    expect(resultOver.x.length).toBe(20);
    expect(resultOver.y.length).toBe(20);
  });

  // 3. Threshold = 2 — returns only first and last point
  test("threshold = 2 returns first and last point", async () => {
    const { x, y } = sineWave(100);
    const result = await fn(x, y, 2);

    expect(result.x.length).toBe(2);
    expect(result.y.length).toBe(2);
    expect(result.x[0]).toBe(x[0]);
    expect(result.y[0]).toBe(y[0]);
    expect(result.x[1]).toBe(x[99]);
    expect(result.y[1]).toBe(y[99]);
  });

  // 4. Empty arrays
  test("empty arrays return empty", async () => {
    const x = new Float64Array(0);
    const y = new Float64Array(0);
    const result = await fn(x, y, 10);

    expect(result.x.length).toBe(0);
    expect(result.y.length).toBe(0);
  });

  // 5. Single point
  test("single point returns the single point", async () => {
    const x = new Float64Array([42]);
    const y = new Float64Array([7]);
    const result = await fn(x, y, 10);

    expect(result.x.length).toBe(1);
    expect(result.y.length).toBe(1);
    expect(result.x[0]).toBe(42);
    expect(result.y[0]).toBe(7);
  });

  // 6. Visual fidelity — sine wave keeps peaks/troughs
  test("sine wave preserves peaks and troughs", async () => {
    const n = 1000;
    const { x, y } = sineWave(n);

    const inputMax = Math.max(...Array.from(y));
    const inputMin = Math.min(...Array.from(y));

    const result = await fn(x, y, 50);
    const resultMax = Math.max(...Array.from(result.y));
    const resultMin = Math.min(...Array.from(result.y));

    // The downsampled result should capture close to the full amplitude
    expect(resultMax).toBeGreaterThan(inputMax * 0.9);
    expect(resultMin).toBeLessThan(inputMin * 0.9);
  });

  // 7. Property-based test with fast-check
  test("property: output length, first/last preserved", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 1000 }),
        fc.integer({ min: 2, max: 100 }),
        async (n, threshold) => {
          const x = new Float64Array(n);
          const y = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            x[i] = i;
            y[i] = Math.sin(i);
          }

          const result = await fn(x, y, threshold);
          const expectedLen = Math.min(n, threshold);

          expect(result.x.length).toBe(expectedLen);
          expect(result.y.length).toBe(expectedLen);

          // First point preserved
          expect(result.x[0]).toBe(x[0]);
          expect(result.y[0]).toBe(y[0]);

          // Last point preserved
          expect(result.x[result.x.length - 1]).toBe(x[x.length - 1]);
          expect(result.y[result.y.length - 1]).toBe(y[y.length - 1]);
        },
      ),
      { numRuns: 50 },
    );
  });

  // 8. Monotonic x — output x values are strictly increasing
  test("output x values are strictly increasing", async () => {
    const { x, y } = linearX(500);
    const result = await fn(x, y, 30);

    for (let i = 1; i < result.x.length; i++) {
      expect(result.x[i]).toBeGreaterThan(result.x[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// m4 — variable output length (first/min/max/last per bucket, deduped)
// ---------------------------------------------------------------------------

describe("m4", () => {
  test("produces at most threshold points and preserves endpoints", async () => {
    const { x, y } = sineWave(1000);
    const result = await m4(x, y, 52);

    expect(result.x).toBeInstanceOf(Float64Array);
    expect(result.y).toBeInstanceOf(Float64Array);
    // 4 points per bucket, floor(52/4)=13 buckets, <= 52 after dedup.
    expect(result.x.length).toBeLessThanOrEqual(52);
    expect(result.x.length).toBeGreaterThan(0);
    expect(result.x[0]).toBe(x[0]);
  });

  test("threshold >= input length returns all points", async () => {
    const { x, y } = sineWave(20);
    const result = await m4(x, y, 100);
    expect(result.x.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(result.x[i]).toBe(x[i]);
    }
  });

  test("threshold < 4 returns all points", async () => {
    const { x, y } = sineWave(100);
    const result = await m4(x, y, 2);
    expect(result.x.length).toBe(100);
  });

  test("empty arrays return empty", async () => {
    const result = await m4(new Float64Array(0), new Float64Array(0), 10);
    expect(result.x.length).toBe(0);
  });

  test("captures sine peaks and troughs", async () => {
    const n = 1000;
    const { x, y } = sineWave(n);
    const inputMax = Math.max(...Array.from(y));
    const inputMin = Math.min(...Array.from(y));
    const result = await m4(x, y, 52);
    const resultMax = Math.max(...Array.from(result.y));
    const resultMin = Math.min(...Array.from(result.y));
    expect(resultMax).toBeGreaterThan(inputMax * 0.9);
    expect(resultMin).toBeLessThan(inputMin * 0.9);
  });
});
