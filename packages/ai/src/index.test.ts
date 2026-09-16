import { describe, it, expect } from "vitest";
import {
  parseDataQuery,
  detectAnomalies,
  detectChangepoints,
  autoOptimize,
  summarize,
  summarizeForLLM,
  computeShapeVector,
  shapeSimilarity,
} from "./index.js";

// ─── parseDataQuery ───

describe("parseDataQuery", () => {
  const info = { length: 1000, hasTimestamps: true };

  it('parses "show spikes above 50" as filter operation', () => {
    const result = parseDataQuery("show spikes above 50", info);
    expect(result.operation).toBe("filter");
    expect(result.params.min).toBe(50);
  });

  it('parses "find anomalies" as anomaly operation', () => {
    const result = parseDataQuery("find anomalies", info);
    expect(result.operation).toBe("anomaly");
    expect(result.params.sensitivity).toBe(3);
  });

  it('parses "downsample to 500" as downsample with target 500', () => {
    const result = parseDataQuery("downsample to 500 points", info);
    expect(result.operation).toBe("downsample");
    expect(result.params.target).toBe(500);
  });
});

// ─── detectAnomalies ───

describe("detectAnomalies", () => {
  it("detects a clear spike at index 50", () => {
    const data = new Float64Array(100);
    for (let i = 0; i < 100; i++) data[i] = 10;
    data[50] = 1000; // Clear spike

    const anomalies = detectAnomalies(data);
    expect(anomalies.length).toBeGreaterThan(0);
    const spikeAnomaly = anomalies.find((a) => a.index === 50);
    expect(spikeAnomaly).toBeDefined();
    expect(spikeAnomaly!.type).toBe("spike");
  });

  it("returns no anomalies for smooth data", () => {
    const data = new Float64Array(100);
    for (let i = 0; i < 100; i++) data[i] = 42;

    const anomalies = detectAnomalies(data);
    expect(anomalies.length).toBe(0);
  });

  it("omits non-finite values and preserves original anomaly indices", () => {
    const data = new Float64Array(102).fill(10);
    data[0] = NaN;
    data[51] = 1000;
    data[80] = Infinity;

    const anomalies = detectAnomalies(data);
    expect(anomalies.some((anomaly) => anomaly.index === 51)).toBe(true);
    expect(anomalies.every((anomaly) => Number.isFinite(anomaly.value))).toBe(true);
  });

  it("treats all-non-finite input as empty", () => {
    expect(detectAnomalies(new Float64Array([NaN, Infinity, -Infinity]))).toEqual([]);
  });
});

// ─── detectChangepoints ───

describe("detectChangepoints", () => {
  it("detects a mean shift changepoint", () => {
    const data = new Float64Array(200);
    for (let i = 0; i < 100; i++) data[i] = 10;
    for (let i = 100; i < 200; i++) data[i] = 50;

    const cps = detectChangepoints(data, 10);
    expect(cps.length).toBeGreaterThan(0);
    // The detected changepoint should be near index 100
    const nearShift = cps.some((cp) => Math.abs(cp - 100) < 30);
    expect(nearShift).toBe(true);
  });

  it("maps changepoints back to original indices after omitting gaps", () => {
    const clean = new Float64Array(200);
    const withGaps = new Float64Array(202);
    withGaps[0] = NaN;
    for (let i = 0; i < 100; i++) {
      clean[i] = 10;
      withGaps[i + 1] = 10;
    }
    withGaps[101] = Infinity;
    for (let i = 100; i < 200; i++) {
      clean[i] = 50;
      withGaps[i + 2] = 50;
    }

    const expected = detectChangepoints(clean, 10).map((index) =>
      index < 100 ? index + 1 : index + 2,
    );
    expect(detectChangepoints(withGaps, 10)).toEqual(expected);
  });
});

// ─── autoOptimize ───

describe("autoOptimize", () => {
  it("recommends lttb for monotonic time-series", () => {
    const n = 10000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i;
      y[i] = Math.sin(i / 100); // smooth monotonic x
    }

    const config = autoOptimize(x, y);
    expect(config.algorithm).toBe("lttb");
    expect(config.targetPoints).toBeLessThan(n);
    expect(config.estimatedSpeedup).toBeGreaterThan(1);
  });

  it("recommends minmax_lttb for spiky data", () => {
    const n = 10000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i;
      y[i] = Math.sin(i / 100);
    }
    // Add extreme spikes
    for (let i = 0; i < n; i += 100) {
      y[i] = 1000;
    }

    const config = autoOptimize(x, y);
    expect(config.algorithm).toBe("minmax_lttb");
  });

  it("omits non-finite coordinate pairs from its dataset size", () => {
    const config = autoOptimize(
      new Float64Array([0, 1, NaN, 3, 4]),
      new Float64Array([1, NaN, 100, 3, 5]),
      100,
    );
    expect(config.targetPoints).toBe(3);
    expect(config.reasoning).toContain("3 points");
  });
});

// ─── summarize ───

describe("summarize", () => {
  it("identifies upward trend data as increasing", () => {
    const n = 1000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i;
      y[i] = i * 2 + Math.random() * 0.1; // strong upward trend
    }

    const result = summarize(x, y);
    expect(result.trend).toBe("increasing");
    expect(result.trendSlope).toBeGreaterThan(0);
  });

  it("uses population variance for the supplied window", () => {
    const result = summarize(new Float64Array([0, 1]), new Float64Array([0, 2]));
    expect(result.distribution.mean).toBe(1);
    expect(result.distribution.stddev).toBe(1);
  });

  it("omits non-finite x/y pairs", () => {
    const result = summarize(
      new Float64Array([0, 1, NaN, 3, 4]),
      new Float64Array([1, NaN, 100, 3, 5]),
    );

    expect(result.distribution.mean).toBe(3);
    expect(result.distribution.stddev).toBe(1.633);
    expect(result.summary).toContain("3 points");
  });

  it("treats all-non-finite pairs as empty and handles singleton input", () => {
    const empty = summarize(new Float64Array([NaN, Infinity]), new Float64Array([1, 2]));
    expect(empty.summary).toBe("Empty dataset.");

    const singleton = summarize(new Float64Array([7]), new Float64Array([42]));
    expect(singleton.distribution).toMatchObject({ mean: 42, median: 42, stddev: 0 });
  });
});

// ─── summarizeForLLM ───

describe("summarizeForLLM", () => {
  it("returns non-empty string with key stats", () => {
    const n = 100;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i;
      y[i] = Math.sin(i / 10) * 50 + 50;
    }

    const text = summarizeForLLM(x, y);
    expect(text.length).toBeGreaterThan(50);
    expect(text).toContain("100");
    expect(text).toMatch(/mean|Mean/i);
  });

  it("reports the finite paired observation count", () => {
    const text = summarizeForLLM(
      new Float64Array([0, 1, NaN, 3]),
      new Float64Array([1, NaN, 100, 3]),
    );
    expect(text).toContain("2 time-series points");
  });
});

// ─── computeShapeVector ───

describe("computeShapeVector", () => {
  it("returns Float64Array of correct length", () => {
    const data = new Float64Array(100);
    for (let i = 0; i < 100; i++) data[i] = Math.sin(i / 10);

    const vec = computeShapeVector(data);
    expect(vec).toBeInstanceOf(Float64Array);
    expect(vec.length).toBe(16);
  });

  it("returns correct length for custom dimensions", () => {
    const data = new Float64Array(100);
    for (let i = 0; i < 100; i++) data[i] = i;

    const vec = computeShapeVector(data, 8);
    expect(vec.length).toBe(8);
  });

  it("omits non-finite values and treats all-non-finite input as empty", () => {
    const clean = computeShapeVector(new Float64Array([1, 2, 3, 4]));
    const withGaps = computeShapeVector(new Float64Array([NaN, 1, 2, Infinity, 3, -Infinity, 4]));
    expect(withGaps).toEqual(clean);
    expect(computeShapeVector(new Float64Array([NaN, Infinity]))).toEqual(new Float64Array(16));
  });
});

// ─── shapeSimilarity ───

describe("shapeSimilarity", () => {
  it("gives high similarity (>0.8) for two sine waves", () => {
    const n = 200;
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = Math.sin(i / 10);
      b[i] = Math.sin(i / 10 + 0.3); // slightly phase-shifted
    }

    const vecA = computeShapeVector(a);
    const vecB = computeShapeVector(b);
    const sim = shapeSimilarity(vecA, vecB);
    expect(sim).toBeGreaterThan(0.8);
  });

  it("gives low similarity (<0.5) for sine vs constant", () => {
    const n = 200;
    const sineData = new Float64Array(n);
    const constData = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sineData[i] = Math.sin(i / 10) * 100;
      constData[i] = 50;
    }

    const vecSine = computeShapeVector(sineData);
    const vecConst = computeShapeVector(constData);
    const sim = shapeSimilarity(vecSine, vecConst);
    expect(sim).toBeLessThan(0.5);
  });

  it("omits non-finite feature pairs", () => {
    const a = new Float64Array([1, NaN, 2, Infinity]);
    const b = new Float64Array([1, 10, 2, 20]);
    expect(shapeSimilarity(a, b)).toBeCloseTo(1);
  });
});
