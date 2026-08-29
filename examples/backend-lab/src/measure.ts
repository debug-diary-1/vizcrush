/**
 * The measurement harness for the backend lab.
 *
 * This exists as its own module because the measurement is the point of the
 * demo, and it is the part that is easy to get quietly wrong. Three rules it
 * enforces, each one a mistake seen in a real benchmark page:
 *
 *  1. Nothing else may run while timing. The caller is responsible for pausing
 *     rendering, and `measure` refuses to start if `document.hidden` is set,
 *     because a backgrounded tab is throttled and the numbers are fiction.
 *     A benchmark taken while a canvas animation is running measured a plain
 *     typed-array loop 4.7x slower than the same loop in an idle tab.
 *
 *  2. Report a distribution, not a number. A single run is noise. We keep the
 *     median, the minimum, and the spread, and the UI shows all three, so a
 *     reader can see when a result is unstable rather than trusting one digit.
 *
 *  3. Warm up first. The first calls pay JIT compilation and, on the WASM
 *     path, module instantiation. Those are real costs, but they are startup
 *     costs, and folding them into a steady-state number flatters whichever
 *     backend happens to be measured second.
 */

export interface Timing {
  /** Median of the timed repetitions, in milliseconds. */
  median: number;
  /** Fastest repetition. The closest thing to an uncontended measurement. */
  min: number;
  /** Slowest repetition. Far from `min` means the number is unstable. */
  max: number;
  /** Every timed repetition, in the order it ran. */
  samples: number[];
}

export interface MeasureOptions {
  /** Untimed calls before measurement, to absorb JIT and instantiation. */
  warmup?: number;
  /** Timed repetitions to collect. */
  reps?: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Runs `fn` and returns the distribution of its timings.
 *
 * Yields to the event loop between repetitions so a long measurement cannot
 * lock the page, which would itself perturb later repetitions.
 */
export async function measure(
  fn: () => Promise<unknown>,
  { warmup = 3, reps = 7 }: MeasureOptions = {},
): Promise<Timing> {
  if (typeof document !== "undefined" && document.hidden) {
    throw new Error(
      "Refusing to measure in a hidden tab: browsers throttle background timers, so the result would be meaningless.",
    );
  }

  for (let i = 0; i < warmup; i++) await fn();

  const samples: number[] = [];
  for (let i = 0; i < reps; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
    // Let the event loop breathe; a 5M-point run can take a while.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    median: median(samples),
    min: Math.min(...samples),
    max: Math.max(...samples),
    samples,
  };
}

/**
 * Formats a duration for display. Sub-millisecond results get microseconds,
 * because printing "0.04ms" throws away the digits that matter.
 */
export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 100) return `${ms.toFixed(2)}ms`;
  return `${ms.toFixed(1)}ms`;
}

/**
 * Describes how trustworthy a timing looks, from its own spread.
 *
 * This is deliberately coarse. It is not a statistical test; it is a hint that
 * stops a reader quoting a single unstable number as if it were settled.
 */
export function stability(t: Timing): { label: string; spreadPct: number } {
  const spreadPct = t.median === 0 ? 0 : ((t.max - t.min) / t.median) * 100;
  if (spreadPct < 15) return { label: "stable", spreadPct };
  if (spreadPct < 50) return { label: "noisy", spreadPct };
  return { label: "unstable", spreadPct };
}
