/**
 * Synthetic series generator.
 *
 * Shape matters here. LTTB preserves the *visual* form of a line, so a series
 * that is pure noise makes the downsampling look like it is doing nothing, and
 * a smooth sine makes it look miraculous. This generates something in between:
 * a drifting random walk with a slow seasonal component and occasional spikes,
 * which is roughly what real telemetry looks like and which shows both what
 * LTTB keeps (the spikes and the envelope) and what it drops.
 *
 * The generator is seeded so a given size always produces the same series.
 * Comparing two backends on two different random inputs would be its own quiet
 * benchmarking bug.
 */

/** Deterministic PRNG (mulberry32), so runs are reproducible across reloads. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Series {
  x: Float64Array;
  y: Float64Array;
}

/**
 * Builds `n` points of pseudo-telemetry.
 *
 * `x` is epoch milliseconds at one-second spacing, deliberately: thirteen-digit
 * timestamps are the realistic case, and they are what makes naive f32
 * narrowing lose resolution (see ADR 0004). Keeping them here means the demo
 * exercises the same input shape the library is designed for.
 */
export function generateSeries(n: number, seed = 42): Series {
  const rng = makeRng(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);

  const start = Date.UTC(2026, 0, 1);
  let level = 100;

  for (let i = 0; i < n; i++) {
    x[i] = start + i * 1000;

    // Random walk: the baseline drift.
    level += (rng() - 0.5) * 0.6;
    // Slow seasonal swing, so the series has a visible envelope.
    const seasonal = Math.sin((i / n) * Math.PI * 8) * 12;
    // Fast ripple, the detail LTTB has to decide whether to keep.
    const ripple = Math.sin(i * 0.05) * 1.5;
    // Rare spikes: the features a naive "every Nth point" would miss entirely.
    const spike = rng() < 0.0002 ? (rng() - 0.5) * 90 : 0;

    y[i] = level + seasonal + ripple + spike;
  }

  return { x, y };
}
