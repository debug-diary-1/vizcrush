// @vitest-environment jsdom
import { describe, test, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDownsample, useBin2d, useStats, useStreamingStats } from "./index.js";

describe("useDownsample", () => {
  test("computes downsampled data and clears loading", async () => {
    const x = new Float64Array(Array.from({ length: 50 }, (_, i) => i));
    const y = new Float64Array(Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1)));

    const { result } = renderHook(() => useDownsample(x, y, { threshold: 10 }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.x.length).toBe(10);
    expect(result.current.elapsed).not.toBeNull();
  });

  test("null input yields no data and never enters loading", () => {
    const { result } = renderHook(() => useDownsample(null, null, { threshold: 10 }));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  test("selects the algorithm named in options", async () => {
    const x = new Float64Array(Array.from({ length: 40 }, (_, i) => i));
    const y = new Float64Array(Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? 100 : 1)));

    const { result } = renderHook(() => useDownsample(x, y, { algorithm: "m4", threshold: 8 }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.x.length).toBeGreaterThan(0);
  });

  test("a stale in-flight call is discarded when inputs change before it resolves", async () => {
    const x = new Float64Array(Array.from({ length: 50 }, (_, i) => i));
    const y = new Float64Array(Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1)));

    const { result, rerender } = renderHook(
      ({ threshold }: { threshold: number }) => useDownsample(x, y, { threshold }),
      { initialProps: { threshold: 10 } },
    );
    rerender({ threshold: 20 });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Only the latest (threshold: 20) result should ever be visible.
    expect(result.current.data?.x.length).toBe(20);
  });

  test("clearing inputs invalidates an in-flight result and clears loading", async () => {
    const x = new Float64Array(Array.from({ length: 50 }, (_, i) => i));
    const y = new Float64Array(Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1)));
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDownsample(enabled ? x : null, enabled ? y : null, { threshold: 10 }),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.elapsed).toBeNull();
  });
});

describe("useBin2d", () => {
  test("computes a density grid sized by xBins × yBins", async () => {
    const x = new Float64Array(Array.from({ length: 100 }, (_, i) => i % 10));
    const y = new Float64Array(Array.from({ length: 100 }, (_, i) => Math.floor(i / 10)));

    const { result } = renderHook(() => useBin2d(x, y, { xBins: 4, yBins: 4 }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.grid.length).toBe(16);
  });

  test("defaults to 256×256 bins when no options are given", async () => {
    const x = new Float64Array(Array.from({ length: 20 }, (_, i) => i));
    const y = new Float64Array(Array.from({ length: 20 }, (_, i) => i));

    const { result } = renderHook(() => useBin2d(x, y));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.grid.length).toBe(256 * 256);
  });

  test("recomputes when an explicit data range changes", async () => {
    const x = new Float64Array([0, 1, 2, 8, 9, 10]);
    const y = new Float64Array([0, 1, 2, 8, 9, 10]);
    const { result, rerender } = renderHook(
      ({ xRange }: { xRange: [number, number] }) =>
        useBin2d(x, y, { xBins: 2, yBins: 2, xRange, yRange: xRange }),
      { initialProps: { xRange: [0, 2] as [number, number] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.xEdges.at(-1)).toBe(2);

    rerender({ xRange: [0, 10] });
    await waitFor(() => expect(result.current.data?.xEdges.at(-1)).toBe(10));
  });
});

describe("useStats", () => {
  test("computes summary stats and the requested percentiles", async () => {
    const data = new Float64Array([1, 2, 3, 4, 5]);
    const { result } = renderHook(() => useStats(data, [50]));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.mean).toBe(3);
    expect(result.current.percentiles?.[0]).toBe(3);
  });

  test("omits percentiles when none are requested", async () => {
    const data = new Float64Array([1, 2, 3]);
    const { result } = renderHook(() => useStats(data));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.count).toBe(3);
    expect(result.current.percentiles).toBeNull();
  });

  test("null input yields no data and never enters loading", () => {
    const { result } = renderHook(() => useStats(null));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe("useStreamingStats", () => {
  test("changing windowSize starts a fresh accumulator with the new limit", () => {
    const { result, rerender } = renderHook(
      ({ windowSize }: { windowSize: number }) => useStreamingStats(windowSize),
      { initialProps: { windowSize: 3 } },
    );
    act(() => result.current.pushBatch([1, 2, 3]));
    expect(result.current.stats?.length).toBe(3);

    rerender({ windowSize: 1 });
    act(() => result.current.pushBatch([10, 20]));

    expect(result.current.stats).toMatchObject({ length: 1, mean: 20 });
  });
});
