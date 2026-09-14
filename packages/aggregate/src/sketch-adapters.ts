export interface DDSketchImpl {
  readonly backend: "js" | "wasm";
  add(value: number): void;
  addBatch(values: Float64Array | number[]): void;
  quantile(q: number): number;
  percentiles(pcts: number[]): number[];
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly relativeAccuracy: number;
}

class JsDDSketchImpl implements DDSketchImpl {
  readonly backend = "js" as const;
  readonly #alpha: number;
  readonly #gamma: number;
  readonly #lnGamma: number;
  readonly #positiveBuckets = new Map<number, number>();
  readonly #negativeBuckets = new Map<number, number>();
  #zeroCount = 0;
  #totalCount = 0;
  #min = Infinity;
  #max = -Infinity;

  constructor(relativeAccuracy: number) {
    this.#alpha = Math.max(1e-6, Math.min(1, relativeAccuracy));
    this.#gamma = (1 + this.#alpha) / (1 - this.#alpha);
    this.#lnGamma = Math.log(this.#gamma);
  }

  add(value: number): void {
    if (!isFinite(value)) return;
    this.#totalCount++;
    if (value < this.#min) this.#min = value;
    if (value > this.#max) this.#max = value;

    if (value > 0) {
      const index = this.#bucketIndex(value);
      this.#positiveBuckets.set(index, (this.#positiveBuckets.get(index) ?? 0) + 1);
    } else if (value < 0) {
      const index = this.#bucketIndex(-value);
      this.#negativeBuckets.set(index, (this.#negativeBuckets.get(index) ?? 0) + 1);
    } else {
      this.#zeroCount++;
    }
  }

  addBatch(values: Float64Array | number[]): void {
    for (let index = 0; index < values.length; index++) this.add(values[index] as number);
  }

  quantile(q: number): number {
    if (this.#totalCount === 0) return NaN;
    const targetRank = Math.max(0, Math.min(1, q)) * this.#totalCount;
    let cumulative = 0;

    for (const key of Array.from(this.#negativeBuckets.keys()).sort((a, b) => b - a)) {
      cumulative += this.#negativeBuckets.get(key)!;
      if (cumulative >= targetRank) {
        return -Math.pow(this.#gamma, key) * (2 / (this.#gamma + 1));
      }
    }
    cumulative += this.#zeroCount;
    if (cumulative >= targetRank) return 0;
    for (const key of Array.from(this.#positiveBuckets.keys()).sort((a, b) => a - b)) {
      cumulative += this.#positiveBuckets.get(key)!;
      if (cumulative >= targetRank) {
        return Math.pow(this.#gamma, key) * (2 / (this.#gamma + 1));
      }
    }
    return this.#max;
  }

  percentiles(pcts: number[]): number[] {
    return pcts.map((percentile) => this.quantile(percentile / 100));
  }

  get count(): number {
    return this.#totalCount;
  }
  get min(): number {
    return this.#min;
  }
  get max(): number {
    return this.#max;
  }
  get relativeAccuracy(): number {
    return this.#alpha;
  }

  #bucketIndex(value: number): number {
    return Math.ceil(Math.log(value) / this.#lnGamma);
  }
}

class WasmDDSketchImpl implements DDSketchImpl {
  readonly backend = "wasm" as const;
  readonly #sketch: any;

  constructor(module: any, relativeAccuracy: number) {
    this.#sketch = new module.DDSketch(relativeAccuracy);
  }

  add(value: number): void {
    this.#sketch.add(value);
  }
  addBatch(values: Float64Array | number[]): void {
    this.#sketch.add_batch(values instanceof Float64Array ? values : Float64Array.from(values));
  }
  quantile(q: number): number {
    return this.#sketch.quantile(q);
  }
  percentiles(pcts: number[]): number[] {
    return Array.from(this.#sketch.percentiles(Float64Array.from(pcts)) as Float64Array);
  }
  get count(): number {
    return this.#sketch.count;
  }
  get min(): number {
    return this.#sketch.min;
  }
  get max(): number {
    return this.#sketch.max;
  }
  get relativeAccuracy(): number {
    return this.#sketch.relative_accuracy;
  }
}

/** Internal construction seam used by the public sketch and its parity tests. */
export function createDDSketchImpl(module: unknown | null, relativeAccuracy: number): DDSketchImpl {
  return module
    ? new WasmDDSketchImpl(module, relativeAccuracy)
    : new JsDDSketchImpl(relativeAccuracy);
}
