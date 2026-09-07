import { describe, expect, test } from "vitest";
import * as fc from "fast-check";
import { TimeSeriesSession } from "./session.js";

function series(length: number, start = 0): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(length);
  const y = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    x[index] = start + index;
    y[index] = (start + index) * 10;
  }
  return { x, y };
}

describe("TimeSeriesSession", () => {
  test("validates fixed capacity and output configuration", () => {
    expect(() => new TimeSeriesSession({ capacity: 0, maxOutputPoints: 10 })).toThrow(/capacity/);
    expect(() => new TimeSeriesSession({ capacity: 10, maxOutputPoints: 1.5 })).toThrow(
      /maxOutputPoints/,
    );
    expect(
      () => new TimeSeriesSession({ capacity: 10, maxOutputPoints: 10, pointsPerPixel: 0 }),
    ).toThrow(/pointsPerPixel/);
  });

  test("retains the newest capacity points from an oversized valid history", async () => {
    const session = new TimeSeriesSession({ capacity: 3, maxOutputPoints: 10 });
    const input = series(5);
    expect(session.load(input.x, input.y)).toMatchObject({ retainedPoints: 3, sourceRevision: 1 });

    const result = await session.view({ xMin: -1, xMax: 10, widthCssPixels: 10 });
    expect(Array.from(result.x)).toEqual([2, 3, 4]);
    expect(Array.from(result.y)).toEqual([20, 30, 40]);
    expect(result.reason).toBe("no-kernel");
  });

  test("rejects invalid histories atomically", async () => {
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 10 });
    const valid = series(3);
    session.load(valid.x, valid.y);

    expect(() => session.load(new Float64Array([0, 2, 1]), new Float64Array([0, 20, 10]))).toThrow(
      /nondecreasing/,
    );
    expect(() => session.load(new Float64Array([0, 1]), new Float64Array([0]))).toThrow(
      /equal lengths/,
    );
    expect(() => session.load(new Float64Array([0, 1]), new Float64Array([0, NaN]))).toThrow(
      /finite/,
    );

    const result = await session.view({ xMin: -1, xMax: 10, widthCssPixels: 10 });
    expect(Array.from(result.x)).toEqual([0, 1, 2]);
    expect(session.state.sourceRevision).toBe(1);
  });

  test("selects an inclusive viewport with immediate edge neighbors", async () => {
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 10 });
    const input = series(6);
    session.load(input.x, input.y);
    const result = await session.view({ xMin: 2, xMax: 3, widthCssPixels: 10 });

    expect(Array.from(result.x)).toEqual([1, 2, 3, 4]);
    expect(Array.from(result.y)).toEqual([10, 20, 30, 40]);
    expect(result).toMatchObject({ visiblePoints: 2, edgeNeighborPoints: 2, selectedPoints: 4 });
  });

  test("keeps edge neighbors inside a tiny total reduction budget", async () => {
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 2 });
    const input = series(6);
    session.load(input.x, input.y);
    const result = await session.view({ xMin: 2, xMax: 3, widthCssPixels: 2 });

    expect(Array.from(result.x)).toEqual([1, 4]);
    expect(result.x).toHaveLength(2);
    expect(result.edgeNeighborPoints).toBe(2);
  });

  test("preserves duplicate timestamp order and x/y pairing", async () => {
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 10 });
    session.load(new Float64Array([0, 1, 1, 1, 2]), new Float64Array([0, 10, 11, 12, 20]));
    const result = await session.view({ xMin: 1, xMax: 1, widthCssPixels: 10 });

    expect(Array.from(result.x)).toEqual([0, 1, 1, 1, 2]);
    expect(Array.from(result.y)).toEqual([0, 10, 11, 12, 20]);
    expect(result.visiblePoints).toBe(3);
  });

  test("derives and enforces physical-pixel and configured output budgets", async () => {
    const session = new TimeSeriesSession({
      capacity: 100,
      maxOutputPoints: 7,
      pointsPerPixel: 0.5,
    });
    const input = series(100);
    session.load(input.x, input.y);

    const physical = await session.view(
      { xMin: 0, xMax: 99, widthCssPixels: 4, devicePixelRatio: 2 },
      { backend: "js" },
    );
    expect(physical.pointBudget).toBe(4);
    expect(physical.x).toHaveLength(4);
    expect(physical).toMatchObject({
      requestedBackend: "js",
      backend: "js",
      reason: "explicit-js",
    });

    const capped = await session.view({ xMin: 0, xMax: 99, widthCssPixels: 100 });
    expect(capped.pointBudget).toBe(7);
    expect(capped.x.length).toBeLessThanOrEqual(7);
  });

  test("handles zero width, singleton history, empty ranges, and a one-point budget", async () => {
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 1 });
    session.load(new Float64Array([5]), new Float64Array([50]));
    const zero = await session.view({ xMin: 0, xMax: 10, widthCssPixels: 0 });
    expect(zero.x).toHaveLength(0);
    expect(zero).toMatchObject({ pointBudget: 0, backend: null, reason: "no-kernel" });

    const singleton = await session.view({ xMin: 5, xMax: 5, widthCssPixels: 1 });
    expect(Array.from(singleton.x)).toEqual([5]);

    const larger = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 1 });
    const input = series(5);
    larger.load(input.x, input.y);
    const gap = await larger.view({ xMin: 1.4, xMax: 1.6, widthCssPixels: 1 });
    expect(gap.x).toHaveLength(1);
    expect(gap.x[0]).toBe(1);
  });

  test("returned buffers remain valid after later loads and views", async () => {
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 10 });
    const first = series(4);
    session.load(first.x, first.y);
    const result = await session.view({ xMin: 0, xMax: 3, widthCssPixels: 10 });

    const replacement = series(4, 100);
    session.load(replacement.x, replacement.y);
    await session.view({ xMin: 100, xMax: 103, widthCssPixels: 10 });
    expect(Array.from(result.x)).toEqual([0, 1, 2, 3]);
    expect(Array.from(result.y)).toEqual([0, 10, 20, 30]);
  });

  test("owns a safe copy of loaded inputs", async () => {
    const session = new TimeSeriesSession({ capacity: 10, maxOutputPoints: 10 });
    const input = series(3);
    session.load(input.x, input.y);
    input.x.fill(99);
    input.y.fill(99);

    const result = await session.view({ xMin: -1, xMax: 10, widthCssPixels: 10 });
    expect(Array.from(result.x)).toEqual([0, 1, 2]);
    expect(Array.from(result.y)).toEqual([0, 10, 20]);
  });

  test("retention agrees with a newest-capacity reference", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 100 }),
        async (capacity, length) => {
          const session = new TimeSeriesSession({ capacity, maxOutputPoints: 200 });
          const input = series(length);
          session.load(input.x, input.y);
          const result = await session.view({ xMin: -1, xMax: length + 1, widthCssPixels: 200 });
          const start = Math.max(0, length - capacity);
          expect(Array.from(result.x)).toEqual(Array.from(input.x.slice(start)));
          expect(Array.from(result.y)).toEqual(Array.from(input.y.slice(start)));
        },
      ),
      { numRuns: 100 },
    );
  });

  test("viewport selection, pairing, ordering, and bounds agree with a reference", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 80 }),
        fc.integer({ min: -10, max: 200 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 20 }),
        async (steps, rawMin, span, budget) => {
          const x = new Float64Array(steps.length);
          const y = new Float64Array(steps.length);
          let current = 0;
          for (let index = 0; index < steps.length; index += 1) {
            current += steps[index];
            x[index] = current;
            y[index] = index + 0.25;
          }

          const xMin = rawMin;
          const xMax = rawMin + span;
          const visibleStart = Array.from(x).findIndex((value) => value >= xMin);
          const normalizedVisibleStart = visibleStart === -1 ? x.length : visibleStart;
          let visibleEnd = normalizedVisibleStart;
          while (visibleEnd < x.length && x[visibleEnd] <= xMax) visibleEnd += 1;
          const selectedStart = normalizedVisibleStart > 0 ? normalizedVisibleStart - 1 : 0;
          const selectedEnd = visibleEnd < x.length ? visibleEnd + 1 : visibleEnd;

          const session = new TimeSeriesSession({ capacity: x.length, maxOutputPoints: budget });
          session.load(x, y);
          const result = await session.view({ xMin, xMax, widthCssPixels: budget });

          expect(result.visiblePoints).toBe(visibleEnd - normalizedVisibleStart);
          expect(result.selectedPoints).toBe(selectedEnd - selectedStart);
          expect(result.x.length).toBeLessThanOrEqual(budget);
          expect(result.y).toHaveLength(result.x.length);

          const outputIndexes = Array.from(result.y, (value) => value - 0.25);
          expect(outputIndexes.every(Number.isInteger)).toBe(true);
          expect(
            outputIndexes.every((index) => index >= selectedStart && index < selectedEnd),
          ).toBe(true);
          expect(outputIndexes).toEqual([...outputIndexes].sort((a, b) => a - b));
          for (let index = 0; index < outputIndexes.length; index += 1) {
            expect(result.x[index]).toBe(x[outputIndexes[index]]);
          }

          if (selectedEnd - selectedStart <= budget) {
            expect(outputIndexes).toEqual(
              Array.from(
                { length: selectedEnd - selectedStart },
                (_, index) => selectedStart + index,
              ),
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
