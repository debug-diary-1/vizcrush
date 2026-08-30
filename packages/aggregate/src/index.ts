import type { StatsResult, DownsampleResult, KernelCallOptions } from "@vizcrush/core";
import { defineKernel, createWasmLoader } from "@vizcrush/core";
import { statsCore, percentileCore } from "./cores.js";

export { statsCore, percentileCore } from "./cores.js";

/**
 * Single WASM loader for the vizcrush_aggregate crate.
 *
 * The specifier is the package's own name rather than a relative path, and it
 * is a plain `import()` rather than a hidden one, because both properties are
 * load-bearing for bundled consumers. A relative `../wasm/...` resolves
 * correctly only while this file lives in the package's `dist/`; once a bundler
 * inlines it, the same path resolves against the application chunk and 404s,
 * and the loader's swallow-failures contract turns that into a silent drop to
 * the JS core. Keeping it statically analysable lets bundlers treat the
 * wasm-bindgen glue as a module, rewrite its internal
 * `new URL('..._bg.wasm', import.meta.url)`, and emit the binary as an asset.
 * It stays a dynamic `import()`, so it remains a lazily-fetched chunk.
 */
const loader = createWasmLoader(
  "vizcrush_aggregate",
  () => import("@vizcrush/aggregate/wasm/vizcrush_aggregate.js"),
);

// ── stats ──
// Input crosses the boundary as a Float64Array directly (no Array.from boxing);
// the WASM binding returns [count, min, max, mean, stdDev, variance].
type StatsArgs = [data: Float64Array];

const statsKernel = defineKernel<StatsArgs, StatsResult, [Float64Array], Float64Array>({
  wasmModuleName: "vizcrush_aggregate",
  loader,
  wasmFn: (mod, data) => mod.compute_stats(data) as Float64Array,
  jsFallback: statsCore,
  marshal: (data) => [data],
  unmarshal: (raw) => ({
    count: raw[0],
    min: raw[1],
    max: raw[2],
    mean: raw[3],
    stdDev: raw[4],
    variance: raw[5],
  }),
  sizeOf: (data) => data.length,
});

// ── percentile ──
// `p` (the requested percentile list) also crosses as a Float64Array.
type PercentileArgs = [data: Float64Array, p: number[]];

const percentileKernel = defineKernel<
  PercentileArgs,
  Float64Array,
  [Float64Array, Float64Array],
  Float64Array
>({
  wasmModuleName: "vizcrush_aggregate",
  loader,
  wasmFn: (mod, data, p) => mod.compute_percentiles(data, p) as Float64Array,
  jsFallback: percentileCore,
  marshal: (data, p) => [data, new Float64Array(p)],
  unmarshal: (raw) => new Float64Array(raw),
  sizeOf: (data) => data.length,
});

/**
 * Compute summary statistics in a single pass (Welford's algorithm).
 */
export function stats(data: Float64Array, opts?: KernelCallOptions): Promise<StatsResult> {
  return statsKernel(data, opts);
}

/**
 * Compute percentiles (exact, via sorting).
 */
export function percentile(
  data: Float64Array,
  p: number[],
  opts?: KernelCallOptions,
): Promise<Float64Array> {
  return percentileKernel(data, p, opts);
}

/** The kernels, exposed for the shared parity harness. */
export const aggregateKernels = {
  stats: statsKernel,
  percentile: percentileKernel,
};

/**
 * Rolling window statistics accumulator.
 */
export class StreamingStats {
  private buffer: Float64Array;
  private head = 0;
  private _count = 0;
  private _mean = 0;
  private _m2 = 0;
  private _min = Infinity;
  private _max = -Infinity;

  constructor(private windowSize: number) {
    this.buffer = new Float64Array(windowSize);
  }

  push(value: number): void {
    if (!isFinite(value)) return;

    const wasFull = this._count >= this.windowSize;
    const old = wasFull ? this.buffer[this.head] : undefined;

    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.windowSize;
    if (!wasFull) this._count++;

    if (old !== undefined) {
      // Remove old from running stats
      const n = this._count;
      if (n === 1) {
        this._mean = 0;
        this._m2 = 0;
        this._min = Infinity;
        this._max = -Infinity;
      } else {
        const delta = old - this._mean;
        this._mean = (this._mean * n - old) / (n - 1);
        const delta2 = old - this._mean;
        this._m2 -= delta * delta2;
        if (this._m2 < 0) this._m2 = 0;

        if (old <= this._min || old >= this._max) {
          this.recomputeMinMax();
        }
      }
    }

    // Add new value
    if (value < this._min) this._min = value;
    if (value > this._max) this._max = value;
    const delta = value - this._mean;
    this._mean += delta / this._count;
    const delta2 = value - this._mean;
    this._m2 += delta * delta2;
  }

  pushBatch(values: Float64Array | number[]): void {
    for (let i = 0; i < values.length; i++) {
      this.push(values[i] as number);
    }
  }

  private recomputeMinMax(): void {
    this._min = Infinity;
    this._max = -Infinity;
    const len = Math.min(this._count, this.windowSize);
    for (let i = 0; i < len; i++) {
      const idx = this._count >= this.windowSize ? (this.head + i) % this.windowSize : i;
      const v = this.buffer[idx];
      if (v < this._min) this._min = v;
      if (v > this._max) this._max = v;
    }
  }

  get length(): number {
    return this._count;
  }
  get mean(): number {
    return this._mean;
  }
  get min(): number {
    return this._min;
  }
  get max(): number {
    return this._max;
  }
  get stdDev(): number {
    return this._count < 2 ? 0 : Math.sqrt(this._m2 / (this._count - 1));
  }
  get variance(): number {
    return this._count < 2 ? 0 : this._m2 / (this._count - 1);
  }
}

/**
 * Convenience factory matching the spec API.
 */
export function streamingStats(windowSize: number): StreamingStats {
  return new StreamingStats(windowSize);
}

/**
 * @deprecated Throws. This never worked, and the shape of its output hid that.
 *
 * The implementation returned array indices rather than data: for any input it
 * produced `y = [0, step, 2*step, ...]`, a straight diagonal containing none of
 * the caller's values. Feeding it 500 points of `42.0` with a spike of `9999`
 * returned `0, 50, 100, ... 450`. Charted, that looks like a plausible series,
 * which is the reason this throws rather than staying deprecated: a silent wrong
 * answer is worse than a loud failure, and a JSDoc tag is invisible at runtime
 * and to JavaScript callers.
 *
 * There is no drop-in replacement because `StreamingStats` is a fixed-size
 * rolling window over *values*; it never retained the x/y history a downsampler
 * needs. Keep that history in application state and downsample it directly:
 *
 * ```ts
 * import { lttb } from "@vizcrush/downsample";
 * const { x, y } = await lttb(historyX, historyY, 1000);
 * ```
 */
export function appendAndDownsample(
  _acc: StreamingStats,
  _newData: Float64Array,
  _targetN: number,
): DownsampleResult {
  throw new Error(
    "appendAndDownsample() was never implemented: it returned array indices, not your data. " +
      "Keep chart history in application state and call lttb() from @vizcrush/downsample instead. " +
      "See https://github.com/debug-diary-1/vizcrush/blob/main/docs/user-guide/streaming.md",
  );
}

// ---------------------------------------------------------------------------
// Streaming Sketch Algorithms
// ---------------------------------------------------------------------------

/**
 * Reservoir sampling: maintain a uniform random sample of k items from a stream.
 * Uses xorshift32 RNG for deterministic, fast randomness.
 */
export class ReservoirSampler {
  private _k: number;
  private _reservoir: number[];
  private _count: number;
  private _rngState: number;

  constructor(k: number) {
    this._k = Math.max(1, k | 0);
    this._reservoir = [];
    this._count = 0;
    // Seed RNG from k (avoid zero state)
    this._rngState = (k * 2654435761) | 0 || 1;
  }

  private _nextRng(): number {
    let s = this._rngState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this._rngState = s;
    return (s >>> 0) / 0x100000000;
  }

  add(value: number): void {
    if (!isFinite(value)) return;
    this._count++;
    if (this._reservoir.length < this._k) {
      this._reservoir.push(value);
    } else {
      const j = Math.floor(this._nextRng() * this._count);
      if (j < this._k) {
        this._reservoir[j] = value;
      }
    }
  }

  addBatch(values: Float64Array | number[]): void {
    for (let i = 0; i < values.length; i++) {
      this.add(values[i] as number);
    }
  }

  get sample(): Float64Array {
    return new Float64Array(this._reservoir);
  }

  get count(): number {
    return this._count;
  }

  get capacity(): number {
    return this._k;
  }
}

/**
 * DDSketch: a quantile sketch with guaranteed relative accuracy.
 * Uses logarithmic bucket mapping for both positive and negative values.
 *
 * Backend is chosen once, at construction: WASM if the aggregate module
 * already happened to be loaded (e.g. by an earlier `stats()`/`percentile()`
 * call, or an explicit `loader.load()`), the JS core otherwise — for this
 * instance's whole lifetime. A sketch is typically long-lived and fed one
 * value at a time, so the choice can't be made async per call the way a
 * one-shot kernel call can; see `WasmLoader.moduleSync`.
 */
export class DDSketch {
  private _alpha: number;
  private _gamma: number;
  private _lnGamma: number;
  private _positiveBuckets: Map<number, number>;
  private _negativeBuckets: Map<number, number>;
  private _zeroCount: number;
  private _totalCount: number;
  private _min: number;
  private _max: number;
  private _wasm?: any;

  constructor(relativeAccuracy: number = 0.01) {
    this._alpha = Math.max(1e-6, Math.min(1, relativeAccuracy));
    this._gamma = (1 + this._alpha) / (1 - this._alpha);
    this._lnGamma = Math.log(this._gamma);
    this._positiveBuckets = new Map();
    this._negativeBuckets = new Map();
    this._zeroCount = 0;
    this._totalCount = 0;
    this._min = Infinity;
    this._max = -Infinity;

    const mod = loader.moduleSync as any;
    if (mod) {
      this._wasm = new mod.DDSketch(relativeAccuracy);
    }
  }

  private _bucketIndex(v: number): number {
    return Math.ceil(Math.log(v) / this._lnGamma);
  }

  add(value: number): void {
    if (this._wasm) {
      this._wasm.add(value);
      return;
    }
    if (!isFinite(value)) return;
    this._totalCount++;
    if (value < this._min) this._min = value;
    if (value > this._max) this._max = value;

    if (value > 0) {
      const idx = this._bucketIndex(value);
      this._positiveBuckets.set(idx, (this._positiveBuckets.get(idx) || 0) + 1);
    } else if (value < 0) {
      const idx = this._bucketIndex(-value);
      this._negativeBuckets.set(idx, (this._negativeBuckets.get(idx) || 0) + 1);
    } else {
      this._zeroCount++;
    }
  }

  addBatch(values: Float64Array | number[]): void {
    if (this._wasm) {
      this._wasm.add_batch(values instanceof Float64Array ? values : Float64Array.from(values));
      return;
    }
    for (let i = 0; i < values.length; i++) {
      this.add(values[i] as number);
    }
  }

  quantile(q: number): number {
    if (this._wasm) return this._wasm.quantile(q);

    if (this._totalCount === 0) return NaN;
    q = Math.max(0, Math.min(1, q));
    const targetRank = q * this._totalCount;

    // Walk negative buckets in descending key order (most negative first)
    const negKeys = Array.from(this._negativeBuckets.keys()).sort((a, b) => b - a);
    let cumulative = 0;
    for (const key of negKeys) {
      cumulative += this._negativeBuckets.get(key)!;
      if (cumulative >= targetRank) {
        return -Math.pow(this._gamma, key) * (2 / (this._gamma + 1));
      }
    }

    // Zero bucket
    cumulative += this._zeroCount;
    if (cumulative >= targetRank) return 0;

    // Walk positive buckets in ascending key order
    const posKeys = Array.from(this._positiveBuckets.keys()).sort((a, b) => a - b);
    for (const key of posKeys) {
      cumulative += this._positiveBuckets.get(key)!;
      if (cumulative >= targetRank) {
        return Math.pow(this._gamma, key) * (2 / (this._gamma + 1));
      }
    }

    return this._max;
  }

  percentiles(pcts: number[]): number[] {
    if (this._wasm)
      return Array.from(this._wasm.percentiles(Float64Array.from(pcts)) as Float64Array);
    return pcts.map((p) => this.quantile(p / 100));
  }

  get count(): number {
    return this._wasm ? this._wasm.count : this._totalCount;
  }

  get min(): number {
    return this._wasm ? this._wasm.min : this._min;
  }

  get max(): number {
    return this._wasm ? this._wasm.max : this._max;
  }

  get relativeAccuracy(): number {
    return this._wasm ? this._wasm.relative_accuracy : this._alpha;
  }
}

/**
 * KLL sketch: space-efficient quantile approximation.
 * Uses multi-level compaction with alternating offsets for unbiased results.
 */
export class KllSketch {
  private _k: number;
  private _levels: number[][];
  private _totalCount: number;
  private _min: number;
  private _max: number;
  private _compactOffset: number;
  private _wasm?: any;

  constructor(k: number = 200) {
    this._k = Math.max(8, k | 0);
    this._levels = [[]];
    this._totalCount = 0;
    this._min = Infinity;
    this._max = -Infinity;
    this._compactOffset = 0;

    const mod = loader.moduleSync as any;
    if (mod) {
      this._wasm = new mod.KllSketch(this._k);
    }
  }

  private _levelCapacity(level: number): number {
    const cap = this._k >>> level;
    return Math.max(4, cap);
  }

  private _compact(level: number): void {
    // Ensure next level exists
    if (level + 1 >= this._levels.length) {
      this._levels.push([]);
    }
    const items = this._levels[level];
    items.sort((a, b) => a - b);

    const survivors: number[] = [];
    const offset = this._compactOffset;
    for (let i = offset; i < items.length; i += 2) {
      survivors.push(items[i]);
    }
    this._compactOffset ^= 1;

    this._levels[level] = [];
    for (const s of survivors) {
      this._levels[level + 1].push(s);
    }

    // Recursively compact if next level is also full
    if (this._levels[level + 1].length >= this._levelCapacity(level + 1) * 2) {
      this._compact(level + 1);
    }
  }

  add(value: number): void {
    if (this._wasm) {
      this._wasm.add(value);
      return;
    }
    if (!isFinite(value)) return;
    this._totalCount++;
    if (value < this._min) this._min = value;
    if (value > this._max) this._max = value;

    this._levels[0].push(value);
    if (this._levels[0].length >= this._k * 2) {
      this._compact(0);
    }
  }

  addBatch(values: Float64Array | number[]): void {
    if (this._wasm) {
      this._wasm.add_batch(values instanceof Float64Array ? values : Float64Array.from(values));
      return;
    }
    for (let i = 0; i < values.length; i++) {
      this.add(values[i] as number);
    }
  }

  quantile(q: number): number {
    if (this._wasm) return this._wasm.quantile(q);

    if (this._totalCount === 0) return NaN;
    q = Math.max(0, Math.min(1, q));

    // Flatten all levels with weights
    const weighted: { value: number; weight: number }[] = [];
    for (let level = 0; level < this._levels.length; level++) {
      const w = 1 << level;
      for (const v of this._levels[level]) {
        weighted.push({ value: v, weight: w });
      }
    }
    weighted.sort((a, b) => a.value - b.value);

    const targetRank = q * this._totalCount;
    let cumulative = 0;
    for (const item of weighted) {
      cumulative += item.weight;
      if (cumulative >= targetRank) return item.value;
    }
    return this._max;
  }

  rank(value: number): number {
    if (this._wasm) return this._wasm.rank(value);

    if (this._totalCount === 0) return NaN;
    let below = 0;
    for (let level = 0; level < this._levels.length; level++) {
      const w = 1 << level;
      for (const v of this._levels[level]) {
        if (v < value) below += w;
      }
    }
    return below / this._totalCount;
  }

  cdf(splitPoints: number[]): number[] {
    if (this._wasm) {
      return Array.from(this._wasm.cdf(Float64Array.from(splitPoints)) as Float64Array);
    }
    return splitPoints.map((sp) => this.rank(sp));
  }

  get count(): number {
    return this._wasm ? this._wasm.count : this._totalCount;
  }

  get min(): number {
    return this._wasm ? this._wasm.min : this._min;
  }

  get max(): number {
    return this._wasm ? this._wasm.max : this._max;
  }

  get numRetained(): number {
    if (this._wasm) return this._wasm.num_retained;
    let total = 0;
    for (const level of this._levels) {
      total += level.length;
    }
    return total;
  }
}

// Shared buffer for f64-to-bits conversion used by HyperLogLog and CountMinSketch
const _hashBuf = new ArrayBuffer(8);
const _hashF64 = new Float64Array(_hashBuf);
const _hashView = new DataView(_hashBuf);

function _hash64(value: number): number {
  _hashF64[0] = value;
  let h = _hashView.getUint32(0, true);
  h ^= _hashView.getUint32(4, true);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * HyperLogLog: probabilistic cardinality estimation.
 * Uses murmur-style hashing of f64 bit patterns.
 */
export class HyperLogLog {
  private _precision: number;
  private _m: number;
  private _registers: Uint8Array;
  private _wasm?: any;

  constructor(precision: number = 14) {
    this._precision = Math.max(4, Math.min(18, precision | 0));
    this._m = 1 << this._precision;
    this._registers = new Uint8Array(this._m);

    const mod = loader.moduleSync as any;
    if (mod) {
      this._wasm = new mod.HyperLogLog(this._precision);
    }
  }

  add(value: number): void {
    if (this._wasm) {
      this._wasm.add(value);
      return;
    }
    if (!isFinite(value)) return;
    const h = _hash64(value);
    const p = this._precision;
    const bucket = h >>> (32 - p);
    const remaining = (h << p) | 0;
    const rank = remaining === 0 ? 32 - p + 1 : Math.clz32(remaining) + 1;
    if (rank > this._registers[bucket]) {
      this._registers[bucket] = rank;
    }
  }

  addBatch(values: Float64Array | number[]): void {
    if (this._wasm) {
      this._wasm.add_batch(values instanceof Float64Array ? values : Float64Array.from(values));
      return;
    }
    for (let i = 0; i < values.length; i++) {
      this.add(values[i] as number);
    }
  }

  estimate(): number {
    if (this._wasm) return this._wasm.estimate();

    const m = this._m;

    // Compute alpha_m
    let alphaM: number;
    if (m === 16) alphaM = 0.673;
    else if (m === 32) alphaM = 0.697;
    else if (m === 64) alphaM = 0.709;
    else alphaM = 0.7213 / (1 + 1.079 / m);

    // Harmonic mean
    let sum = 0;
    let zeros = 0;
    for (let j = 0; j < m; j++) {
      sum += Math.pow(2, -this._registers[j]);
      if (this._registers[j] === 0) zeros++;
    }

    let rawEstimate = (alphaM * m * m) / sum;

    // Small range correction (linear counting)
    if (rawEstimate <= 2.5 * m && zeros > 0) {
      rawEstimate = m * Math.log(m / zeros);
    }

    return rawEstimate;
  }

  get precision(): number {
    return this._wasm ? this._wasm.precision : this._precision;
  }

  get stdError(): number {
    return this._wasm ? this._wasm.std_error : 1.04 / Math.sqrt(this._m);
  }
}

/**
 * Count-Min Sketch: probabilistic frequency estimation.
 * Uses multiple hash rows to provide frequency upper-bound estimates.
 */
export class CountMinSketch {
  private _width: number;
  private _depth: number;
  private _table: Uint32Array;
  private _seeds: Uint32Array;
  private _totalCount: number;
  private _wasm?: any;

  constructor(width: number = 1024, depth: number = 5) {
    this._width = Math.max(1, width | 0);
    this._depth = Math.max(1, depth | 0);
    this._table = new Uint32Array(this._width * this._depth);
    this._seeds = new Uint32Array(this._depth);
    // Initialize seeds with distinct primes
    const primes = [
      0x9e3779b9, 0x517cc1b7, 0x6c62272e, 0x2e1b2138, 0x27d4eb2d, 0x85ebca77, 0xcc9e2d51,
      0x1b873593, 0xe6546b64, 0x38b34ae5,
    ];
    for (let i = 0; i < this._depth; i++) {
      this._seeds[i] = primes[i % primes.length] ^ (i * 0xdeadbeef);
    }
    this._totalCount = 0;

    const mod = loader.moduleSync as any;
    if (mod) {
      this._wasm = new mod.CountMinSketch(this._width, this._depth);
    }
  }

  private _hashForDepth(value: number, depth: number): number {
    const h = _hash64(value);
    let mixed = Math.imul(h, this._seeds[depth]);
    mixed ^= mixed >>> 16;
    return (mixed >>> 0) % this._width;
  }

  add(value: number): void {
    if (this._wasm) {
      this._wasm.add(value);
      return;
    }
    if (!isFinite(value)) return;
    this._totalCount++;
    for (let d = 0; d < this._depth; d++) {
      const col = this._hashForDepth(value, d);
      this._table[d * this._width + col]++;
    }
  }

  addWithCount(value: number, count: number): void {
    if (this._wasm) {
      this._wasm.add_with_count(value, BigInt(Math.round(count)));
      return;
    }
    if (!isFinite(value)) return;
    this._totalCount += count;
    for (let d = 0; d < this._depth; d++) {
      const col = this._hashForDepth(value, d);
      this._table[d * this._width + col] += count;
    }
  }

  addBatch(values: Float64Array | number[]): void {
    if (this._wasm) {
      this._wasm.add_batch(values instanceof Float64Array ? values : Float64Array.from(values));
      return;
    }
    for (let i = 0; i < values.length; i++) {
      this.add(values[i] as number);
    }
  }

  estimate(value: number): number {
    if (this._wasm) return Number(this._wasm.estimate(value) as bigint);

    let min = Infinity;
    for (let d = 0; d < this._depth; d++) {
      const col = this._hashForDepth(value, d);
      const c = this._table[d * this._width + col];
      if (c < min) min = c;
    }
    return min;
  }

  get count(): number {
    return this._wasm ? this._wasm.count : this._totalCount;
  }

  get width(): number {
    return this._wasm ? this._wasm.width : this._width;
  }

  get depth(): number {
    return this._wasm ? this._wasm.depth : this._depth;
  }
}
