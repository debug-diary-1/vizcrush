// Shared statistics for the campaign analyses.
//
// Two dispersions appear in this work and they are not interchangeable:
//
//   within-session  spread of timed blocks inside ONE browser process. Small,
//                   and describes timing noise only. Reported as a bootstrap
//                   interval of the median.
//   across-launch   spread of session medians over INDEPENDENT browser
//                   launches. This is the one that matters when comparing
//                   engine builds, and it is reported as an observed range.
//
// Reporting the first as though it were the second overstates precision, so the
// two are kept apart here and in every table that consumes them.

export const sorted = (xs) => [...xs].sort((a, b) => a - b);

export function quantile(xs, q) {
  const s = sorted(xs);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs) => quantile(xs, 0.5);
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function relativeStdDevPct(xs) {
  const m = mean(xs);
  const variance = xs.reduce((acc, v) => acc + (v - m) ** 2, 0) / xs.length;
  return (Math.sqrt(variance) / m) * 100;
}

// Deterministic PRNG so a reported interval is reproducible from the artifact.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let v = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
    return ((v ^ (v >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 95% bootstrap interval of the median. WITHIN-SESSION only: see file header. */
export function bootstrapMedianCi(samples, { resamples = 10_000, seed = 7 } = {}) {
  const random = mulberry32(seed);
  const medians = [];
  for (let b = 0; b < resamples; b += 1) {
    const draw = Array.from(
      { length: samples.length },
      () => samples[Math.floor(random() * samples.length)],
    );
    medians.push(median(draw));
  }
  return [quantile(medians, 0.025), quantile(medians, 0.975)];
}

export function describe(samples) {
  const s = sorted(samples);
  return {
    n: samples.length,
    median: median(s),
    q1: quantile(s, 0.25),
    q3: quantile(s, 0.75),
    min: s[0],
    max: s[s.length - 1],
    rsdPct: relativeStdDevPct(samples),
    ci95WithinSession: bootstrapMedianCi(samples),
  };
}
