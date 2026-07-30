import type { DownsampleResult } from "@vizcrush/core";

/**
 * Pure, synchronous JS cores for every downsample algorithm. These are the
 * kernel's JS adapters: no WASM, no loading, no async. They are imported
 * directly by the async shells in `index.ts`, by the parity harness, and by the
 * MCP server — so there is exactly one implementation of each algorithm in JS.
 *
 * Each core mirrors its Rust/WASM counterpart so the parity harness can assert
 * JS ≡ WASM on identical input.
 */

function allPoints(x: Float64Array, y: Float64Array): DownsampleResult {
  return { x: new Float64Array(x), y: new Float64Array(y) };
}

/** Largest-Triangle-Three-Buckets. Mirrors `vizcrush_downsample::lttb`. */
export function lttbCore(x: Float64Array, y: Float64Array, threshold: number): DownsampleResult {
  const n = x.length;
  if (threshold >= n || threshold < 2) {
    return allPoints(x, y);
  }

  const outX = new Float64Array(threshold);
  const outY = new Float64Array(threshold);
  outX[0] = x[0];
  outY[0] = y[0];

  const bucketSize = (n - 2) / (threshold - 2);
  let prevX = x[0];
  let prevY = y[0];

  for (let i = 0; i < threshold - 2; i++) {
    const bucketStart = Math.floor(i * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    let avgX = 0;
    let avgY = 0;
    const nextCount = nextEnd - nextStart;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += x[j];
      avgY += y[j];
    }
    if (nextCount > 0) {
      avgX /= nextCount;
      avgY /= nextCount;
    }

    let maxArea = -1;
    let maxIdx = bucketStart;
    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs((prevX - avgX) * (y[j] - prevY) - (prevX - x[j]) * (avgY - prevY));
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }

    outX[i + 1] = x[maxIdx];
    outY[i + 1] = y[maxIdx];
    prevX = x[maxIdx];
    prevY = y[maxIdx];
  }

  outX[threshold - 1] = x[n - 1];
  outY[threshold - 1] = y[n - 1];

  return { x: outX, y: outY };
}

/** Largest-Triangle-One-Bucket. Mirrors `vizcrush_downsample::ltob`. */
export function ltobCore(x: Float64Array, y: Float64Array, threshold: number): DownsampleResult {
  const n = x.length;
  if (threshold >= n || threshold < 2) {
    return allPoints(x, y);
  }

  const out: number[] = [];
  out.push(x[0], y[0]);

  const bucketSize = (n - 2) / (threshold - 2);

  for (let i = 0; i < threshold - 2; i++) {
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);
    if (start >= end) continue;

    let maxArea = -1;
    let maxIdx = start;
    const firstX = x[start];
    const firstY = y[start];
    const lastX = x[end - 1];
    const lastY = y[end - 1];

    for (let j = start; j < end; j++) {
      const area = Math.abs(
        (firstX - lastX) * (y[j] - firstY) - (firstX - x[j]) * (lastY - firstY),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }
    out.push(x[maxIdx], y[maxIdx]);
  }

  out.push(x[n - 1], y[n - 1]);

  return deinterleave(out);
}

/** M4 min-max-per-bucket. Mirrors `vizcrush_downsample::m4`. */
export function m4Core(x: Float64Array, y: Float64Array, threshold: number): DownsampleResult {
  const n = x.length;
  if (threshold >= n || threshold < 4) {
    return allPoints(x, y);
  }

  const numBuckets = Math.floor(threshold / 4);
  const bucketSize = n / numBuckets;
  const out: number[] = [];

  for (let b = 0; b < numBuckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(Math.floor((b + 1) * bucketSize), n);
    if (start >= end) continue;

    let minIdx = start;
    let maxIdx = start;
    const firstIdx = start;
    const lastIdx = end - 1;

    for (let j = start; j < end; j++) {
      if (y[j] < y[minIdx]) minIdx = j;
      if (y[j] > y[maxIdx]) maxIdx = j;
    }

    // Unique indices sorted by position (matches Rust sort_unstable + dedup).
    const indices = [firstIdx, minIdx, maxIdx, lastIdx].sort((a, b) => a - b);
    let prev = -1;
    for (const idx of indices) {
      if (idx === prev) continue;
      out.push(x[idx], y[idx]);
      prev = idx;
    }
  }

  return deinterleave(out);
}

/** MinMax pre-selection + LTTB. Mirrors `vizcrush_downsample::minmax_lttb`. */
export function minMaxLttbCore(
  x: Float64Array,
  y: Float64Array,
  threshold: number,
): DownsampleResult {
  const n = x.length;
  if (threshold >= n || threshold < 2) {
    return allPoints(x, y);
  }

  const preThreshold = Math.min(threshold * 4, n);
  if (preThreshold >= n) {
    return lttbCore(x, y, threshold);
  }

  const halfMinusOne = Math.floor(preThreshold / 2) - 1;
  const bucketSize = (n - 2) / halfMinusOne;
  const preX: number[] = [];
  const preY: number[] = [];

  preX.push(x[0]);
  preY.push(y[0]);

  for (let i = 0; i < halfMinusOne; i++) {
    const start = Math.floor(i * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);
    if (start >= end) continue;

    let minIdx = start;
    let maxIdx = start;
    let minVal = y[start];
    let maxVal = y[start];

    for (let j = start + 1; j < end; j++) {
      if (y[j] < minVal) {
        minVal = y[j];
        minIdx = j;
      }
      if (y[j] > maxVal) {
        maxVal = y[j];
        maxIdx = j;
      }
    }

    if (minIdx <= maxIdx) {
      preX.push(x[minIdx]);
      preY.push(y[minIdx]);
      if (minIdx !== maxIdx) {
        preX.push(x[maxIdx]);
        preY.push(y[maxIdx]);
      }
    } else {
      preX.push(x[maxIdx]);
      preY.push(y[maxIdx]);
      preX.push(x[minIdx]);
      preY.push(y[minIdx]);
    }
  }

  preX.push(x[n - 1]);
  preY.push(y[n - 1]);

  return lttbCore(Float64Array.from(preX), Float64Array.from(preY), threshold);
}

/**
 * Deinterleave a flat `[x0,y0,x1,y1,...]` representation into separate x/y
 * Float64Arrays. This is the kernel's `unmarshal` for downsample: the WASM
 * binding returns interleaved `Vec<f64>`, the JS cores build it likewise.
 */
export function deinterleave(interleaved: Float64Array | number[]): DownsampleResult {
  const arr = interleaved instanceof Float64Array ? interleaved : Float64Array.from(interleaved);
  const m = arr.length / 2;
  const x = new Float64Array(m);
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    x[i] = arr[i * 2];
    y[i] = arr[i * 2 + 1];
  }
  return { x, y };
}
