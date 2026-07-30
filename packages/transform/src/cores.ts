/**
 * Pure, synchronous JS cores for the WASM-backed transform algorithms
 * (normalize, logTransform, powerTransform, sortBy). These are the kernel's JS
 * adapters: no WASM, no loading, no async. They are imported directly by the
 * async shells in `index.ts`, by the parity harness, and by the MCP server — so
 * there is exactly one implementation of each algorithm in JS.
 *
 * Each core mirrors its Rust/WASM counterpart so the parity harness can assert
 * JS ≡ WASM on identical input. The pure-JS-only functions (filterRange,
 * quantileNormalize, lnTransform/log10Transform wrappers) have no separate WASM
 * binding and live in `index.ts` unchanged.
 */

/**
 * Min-max normalization to [0, 1]. Mirrors `vizcrush_transform::normalize`:
 * a custom range is used only when both bounds are finite and `rMax > rMin`;
 * otherwise the finite min/max of the data is used. When the effective range is
 * degenerate (non-finite or constant), finite inputs map to 0 and non-finite
 * inputs map to NaN. NaN/Infinity inputs are otherwise preserved as NaN.
 */
export function normalizeCore(data: Float64Array, rMin: number, rMax: number): Float64Array {
  let min: number;
  let max: number;
  if (isFinite(rMin) && isFinite(rMax) && rMax > rMin) {
    min = rMin;
    max = rMax;
  } else {
    min = Infinity;
    max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }

  const out = new Float64Array(data.length);
  if (!isFinite(min) || !isFinite(max) || max <= min) {
    // All non-finite or constant: finite -> 0, non-finite -> NaN.
    for (let i = 0; i < data.length; i++) {
      out[i] = isFinite(data[i]) ? 0 : NaN;
    }
    return out;
  }

  const invRange = 1 / (max - min);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    out[i] = !isFinite(v) ? NaN : Math.max(0, Math.min(1, (v - min) * invRange));
  }
  return out;
}

/**
 * Sort a Float64Array. Mirrors `vizcrush_transform::radix_sort` (ascending,
 * with descending iterating in reverse). NaN-free total order matches the
 * radix sort's u64 key ordering.
 */
export function sortCore(data: Float64Array, descending: boolean): Float64Array {
  const arr = Array.from(data);
  arr.sort((a, b) => (descending ? b - a : a - b));
  return new Float64Array(arr);
}

/**
 * Reorder `data` by the sorted order of `keys`. Mirrors
 * `vizcrush_transform::sort_by_keys` (ascending stable index sort); the async
 * shell reverses the result for the descending case, matching the prior API.
 */
export function sortByKeysCore(
  data: Float64Array,
  keys: Float64Array,
  descending: boolean,
): Float64Array {
  const indices = Array.from({ length: keys.length }, (_, i) => i);
  indices.sort((a, b) => (descending ? keys[b] - keys[a] : keys[a] - keys[b]));
  return new Float64Array(indices.map((i) => data[i]));
}

/**
 * Log transform with arbitrary base. Mirrors
 * `vizcrush_transform::log_transform`: non-finite or non-positive inputs -> NaN.
 */
export function logTransformCore(data: Float64Array, base: number): Float64Array {
  const lnBase = Math.log(base);
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    out[i] = !isFinite(v) || v <= 0 ? NaN : Math.log(v) / lnBase;
  }
  return out;
}

/**
 * Power transform. Mirrors `vizcrush_transform::power_transform`: non-finite
 * inputs -> NaN, otherwise `v ** exponent`.
 */
export function powerTransformCore(data: Float64Array, exponent: number): Float64Array {
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    out[i] = !isFinite(v) ? NaN : Math.pow(v, exponent);
  }
  return out;
}
