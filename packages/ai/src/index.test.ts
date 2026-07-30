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
});
