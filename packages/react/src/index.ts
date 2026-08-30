import { useState, useEffect, useRef, useCallback } from "react";
import type {
  VizcrushContext,
  DownsampleResult,
  Bin2dResult,
  Bin2dOptions,
  StatsResult,
} from "@vizcrush/core";
import { init } from "@vizcrush/core";
import { lttb, minMaxLttb, m4 } from "@vizcrush/downsample";
import { bin2d } from "@vizcrush/bin";
import { stats, percentile } from "@vizcrush/aggregate";

// ── Context Hook ──

export function useVizcrush(): VizcrushContext | null {
  const [ctx, setCtx] = useState<VizcrushContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    init().then((c) => {
      if (!cancelled) setCtx(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ctx;
}

// ── Async Kernel Hook ──
// The one seam every "call a vizcrush kernel from a component" hook crosses:
// state, the stale-closure race guard, and timing live here once. A hook
// built on this is just "what to compute" plus "when to recompute."

interface UseAsyncKernelResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  elapsed: number | null;
}

function useAsyncKernel<T>(
  compute: (() => Promise<T>) | null,
  deps: unknown[],
): UseAsyncKernelResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const pendingRef = useRef(0);

  useEffect(() => {
    const id = ++pendingRef.current;
    if (!compute) {
      setData(null);
      setLoading(false);
      setError(null);
      setElapsed(null);
      return;
    }

    setLoading(true);
    setError(null);

    const t0 = performance.now();

    compute()
      .then((result) => {
        if (id === pendingRef.current) {
          setData(result);
          setElapsed(performance.now() - t0);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (id === pendingRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    // `deps` is caller-supplied and intentionally the effect's only dependency
    // list; `compute` itself is a fresh closure each render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, elapsed };
}

// ── Downsample Hook ──

export interface UseDownsampleOptions {
  algorithm?: "lttb" | "minmax_lttb" | "m4";
  threshold: number;
}

export interface UseDownsampleResult {
  data: DownsampleResult | null;
  loading: boolean;
  error: Error | null;
  elapsed: number | null;
}

export function useDownsample(
  x: Float64Array | null,
  y: Float64Array | null,
  options: UseDownsampleOptions,
): UseDownsampleResult {
  const compute =
    x && y && x.length > 0
      ? () => {
          const fn =
            options.algorithm === "minmax_lttb"
              ? minMaxLttb
              : options.algorithm === "m4"
                ? m4
                : lttb;
          return fn(x, y, options.threshold);
        }
      : null;

  return useAsyncKernel(compute, [x, y, options.threshold, options.algorithm]);
}

// ── Bin2d Hook ──

export interface UseBin2dResult {
  data: Bin2dResult | null;
  loading: boolean;
  error: Error | null;
  elapsed: number | null;
}

export function useBin2d(
  x: Float64Array | null,
  y: Float64Array | null,
  options?: Bin2dOptions,
): UseBin2dResult {
  const xBins = options?.xBins ?? 256;
  const yBins = options?.yBins ?? 256;
  const xRange = options?.xRange;
  const yRange = options?.yRange;

  const compute = x && y && x.length > 0 ? () => bin2d(x, y, { xBins, yBins, ...options }) : null;

  return useAsyncKernel(compute, [
    x,
    y,
    xBins,
    yBins,
    xRange?.[0],
    xRange?.[1],
    yRange?.[0],
    yRange?.[1],
  ]);
}

// ── Stats Hook ──

export interface UseStatsResult {
  data: StatsResult | null;
  percentiles: Float64Array | null;
  loading: boolean;
  error: Error | null;
}

export function useStats(data: Float64Array | null, pcts?: number[]): UseStatsResult {
  const compute =
    data && data.length > 0
      ? (): Promise<[StatsResult, Float64Array | null]> =>
          Promise.all([
            stats(data),
            pcts && pcts.length > 0 ? percentile(data, pcts) : Promise.resolve(null),
          ])
      : null;

  const { data: result, loading, error } = useAsyncKernel(compute, [data, pcts?.join(",")]);

  return {
    data: result ? result[0] : null,
    percentiles: result ? result[1] : null,
    loading,
    error,
  };
}

// ── Streaming Hook ──

import { StreamingStats, streamingStats } from "@vizcrush/aggregate";

export interface UseStreamingStatsResult {
  stats: {
    mean: number;
    min: number;
    max: number;
    stdDev: number;
    length: number;
  } | null;
  push: (value: number) => void;
  pushBatch: (values: Float64Array | number[]) => void;
  reset: () => void;
}

export function useStreamingStats(windowSize: number): UseStreamingStatsResult {
  const accRef = useRef<StreamingStats>(streamingStats(windowSize));
  const windowSizeRef = useRef(windowSize);
  const [, forceUpdate] = useState(0);

  if (windowSizeRef.current !== windowSize) {
    windowSizeRef.current = windowSize;
    accRef.current = streamingStats(windowSize);
  }

  const push = useCallback((value: number) => {
    accRef.current.push(value);
    forceUpdate((n) => n + 1);
  }, []);

  const pushBatch = useCallback((values: Float64Array | number[]) => {
    accRef.current.pushBatch(values);
    forceUpdate((n) => n + 1);
  }, []);

  const reset = useCallback(() => {
    accRef.current = streamingStats(windowSize);
    forceUpdate((n) => n + 1);
  }, [windowSize]);

  const acc = accRef.current;
  const statsData =
    acc.length > 0
      ? {
          mean: acc.mean,
          min: acc.min,
          max: acc.max,
          stdDev: acc.stdDev,
          length: acc.length,
        }
      : null;

  return { stats: statsData, push, pushBatch, reset };
}
