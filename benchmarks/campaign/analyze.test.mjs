import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeVersions, validateVersionResults } from "./analyze-versions.mjs";
import { summarizeEngines, validateEngineResults, validateNodeResults } from "./analyze.mjs";
import { median } from "./stats.mjs";

const read = (name) => readFileSync(new URL(`./results/${name}`, import.meta.url), "utf8");

describe("summarizeEngines", () => {
  it("computes ratios and stats from a minimal raw file", () => {
    const engine = () => ({
      version: "1.0",
      userAgent: "ua",
      timerResolutionProbeMs: 0.001,
      benchmarkSink: 1,
      errors: [],
      sizes: [
        {
          n: 8,
          calls: 10,
          outputLength: 4,
          maxAbsDiff: 0,
          wasm_raw: [1, 1, 1],
          js_core: [4, 4, 4],
          copy_proxy: [0.5, 0.5, 0.5],
          public_api: [2, 2, 2],
        },
      ],
    });
    const raw = {
      startedAt: "2026-01-01T00:00:00.000Z",
      machine: { platform: "test", arch: "test", node: "v0" },
      config: { reps: 3, sizes: [{ n: 8 }] },
      engines: {
        chromium: engine(),
        firefox: engine(),
        webkit: engine(),
      },
    };
    const out = summarizeEngines(raw);
    const cell = out.engines.chromium.sizes[8];
    expect(out.engines.chromium.label).toBe("Chromium (V8)");
    expect(cell.wasmOverJs).toBe(0.25);
    expect(cell.publicApiOverJs).toBe(0.5);
    expect(cell.copyShareOfWasmPct).toBe(50);
    expect(cell.maxAbsDiff).toBe(0);
    expect(cell.callsPerBlock).toBe(10);
    expect(cell.wasm_raw.median).toBe(1);
  });

  it("regenerates the committed analyzed.json bit-for-bit from the committed raw.json", () => {
    const raw = JSON.parse(read("raw.json"));
    const regenerated = `${JSON.stringify(summarizeEngines(raw), null, 2)}\n`;
    expect(regenerated).toBe(read("analyzed.json"));
  });

  it("rejects partial, errored, or non-finite engine artifacts", () => {
    const raw = JSON.parse(read("raw.json"));
    const partial = structuredClone(raw);
    partial.engines.chromium.sizes.pop();
    expect(() => validateEngineResults(partial)).toThrow(/incomplete size/u);

    const errored = structuredClone(raw);
    errored.engines.firefox.errors.push("page exploded");
    expect(() => validateEngineResults(errored)).toThrow(/browser emitted errors/u);

    const invalid = structuredClone(raw);
    invalid.engines.webkit.sizes[0].js_core[0] = Number.NaN;
    expect(() => validateEngineResults(invalid)).toThrow(/invalid js_core sample/u);

    const missing = structuredClone(raw);
    delete missing.engines.firefox;
    expect(() => validateEngineResults(missing)).toThrow(/require exactly/u);

    const missingErrors = structuredClone(raw);
    delete missingErrors.engines.webkit.errors;
    expect(() => validateEngineResults(missingErrors)).toThrow(/errors must be an array/u);
  });

  it("validates the committed Node companion artifact", () => {
    const node = JSON.parse(read("node.json"));
    expect(() => validateNodeResults(node)).not.toThrow();

    const invalid = structuredClone(node);
    invalid.sizes[0].wasm_raw.pop();
    expect(() => validateNodeResults(invalid)).toThrow(/must contain/u);
  });
});

describe("summarizeVersions", () => {
  const reps = 3;
  const sweep = (specs) => {
    const sessions = specs[0].ratios.length;
    const targets = specs.map(({ label, ratios, js = 2 }, buildIndex) => ({
      label,
      version: label,
      sessions: ratios.map((ratio, index) => ({
        index,
        order: index * specs.length + ((buildIndex - index + specs.length) % specs.length),
        benchmarkSink: 1,
        sizes: {
          1_000_000: {
            js_median: js,
            js_min: js,
            wasm_median: ratio * js,
            wasm_min: ratio * js,
            copy_median: 0.5,
            api_median: ratio * js,
            maxAbsDiff: 0,
            samples: {
              wasm_raw: Array(reps).fill(ratio * js),
              js_core: Array(reps).fill(js),
            },
          },
        },
      })),
    }));
    return {
      config: {
        sessions,
        reps,
        sizes: [{ n: 1_000_000 }],
        builds: targets.map((target) => target.label),
      },
      targets,
    };
  };

  it("summarizes per-build ratio distributions", () => {
    const data = sweep([
      { label: "chromium-1", ratios: [0.2, 0.3, 0.25] },
      { label: "chromium-2", ratios: [0.4, 0.4, 0.4] },
    ]);
    const { rows } = summarizeVersions(data);
    expect(rows[0].sessions).toBe(3);
    expect(rows[0].ratios).toEqual([0.2, 0.3, 0.25]);
  });

  it("detects adjacent-build steps in the js baseline", () => {
    const data = sweep([
      { label: "chromium-1", ratios: [0.25], js: 6 },
      { label: "chromium-2", ratios: [0.87], js: 2 },
    ]);
    const { steps } = summarizeVersions(data);
    expect(steps).toHaveLength(1);
    expect(steps[0].jsSpeedup).toBe(3);
    expect(steps[0].ratioBefore).toBe(0.25);
    expect(steps[0].ratioAfter).toBe(0.87);
  });

  it("rejects reproduction from BOTH sides of the prior band", () => {
    const data = sweep([
      { label: "inside", ratios: [0.24, 0.26] },
      { label: "above", ratios: [0.85, 0.9] },
      { label: "below", ratios: [0.05, 0.1] },
    ]);
    const { reproduction } = summarizeVersions(data);
    expect(reproduction.map((v) => v.reproduces)).toEqual([true, false, false]);
  });

  it("rejects missing sessions instead of analyzing a partial sweep", () => {
    const data = sweep([
      { label: "chromium-1", ratios: [0.25, 0.26] },
      { label: "chromium-2", ratios: [0.85, 0.86] },
    ]);
    data.targets[0].sessions.pop();
    expect(() => validateVersionResults(data)).toThrow(/expected 2 sessions/u);
  });

  it("rejects parity, sink, sample-count, and execution-order corruption", () => {
    const base = sweep([
      { label: "chromium-1", ratios: [0.25] },
      { label: "chromium-2", ratios: [0.85] },
    ]);

    const parity = structuredClone(base);
    parity.targets[0].sessions[0].sizes[1_000_000].maxAbsDiff = 1;
    expect(() => validateVersionResults(parity)).toThrow(/parity gate/u);

    const sink = structuredClone(base);
    sink.targets[0].sessions[0].benchmarkSink = Number.NaN;
    expect(() => validateVersionResults(sink)).toThrow(/benchmark sink/u);

    const samples = structuredClone(base);
    samples.targets[0].sessions[0].sizes[1_000_000].samples.js_core.pop();
    expect(() => validateVersionResults(samples)).toThrow(/must contain 3 samples/u);

    const summary = structuredClone(base);
    summary.targets[0].sessions[0].sizes[1_000_000].js_median = 0.01;
    expect(() => validateVersionResults(summary)).toThrow(/does not match raw samples/u);

    const order = structuredClone(base);
    order.targets[1].sessions[0].order = 0;
    expect(() => validateVersionResults(order)).toThrow(/unique and contiguous/u);

    const unbalanced = structuredClone(
      sweep([
        { label: "chromium-1", ratios: [0.25, 0.25] },
        { label: "chromium-2", ratios: [0.85, 0.85] },
      ]),
    );
    const first = unbalanced.targets[0].sessions[1];
    const second = unbalanced.targets[1].sessions[1];
    [first.order, second.order] = [second.order, first.order];
    expect(() => validateVersionResults(unbalanced)).toThrow(/not counterbalanced/u);
  });
});

describe("committed sweep results", () => {
  it("contain the published 148->149 step under the enforced parity gate", () => {
    const data = JSON.parse(read("versions.json"));
    for (const target of data.targets) {
      for (const session of target.sessions) {
        for (const cell of Object.values(session.sizes)) expect(cell.maxAbsDiff).toBe(0);
      }
    }
    const { steps } = summarizeVersions(data);
    const biggest = steps.reduce((a, b) => (a.jsSpeedup > b.jsSpeedup ? a : b));
    expect(biggest.jsSpeedup).toBeGreaterThan(2);
    expect(median(steps.map((s) => s.jsSpeedup))).toBeLessThan(1.5);
  });
});
