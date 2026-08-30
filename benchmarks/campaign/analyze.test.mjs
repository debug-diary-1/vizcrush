import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeVersions } from "./analyze-versions.mjs";
import { summarizeEngines } from "./analyze.mjs";
import { median } from "./stats.mjs";

const read = (name) => readFileSync(new URL(`./results/${name}`, import.meta.url), "utf8");

describe("summarizeEngines", () => {
  it("computes ratios and stats from a minimal raw file", () => {
    const raw = {
      startedAt: "2026-01-01T00:00:00.000Z",
      machine: { platform: "test", arch: "test", node: "v0" },
      config: {},
      engines: {
        chromium: {
          version: "1.0",
          userAgent: "ua",
          timerResolutionProbeMs: 0.001,
          sizes: [
            {
              n: 8,
              calls: 10,
              maxAbsDiff: 0,
              wasm_raw: [1, 1, 1],
              js_core: [4, 4, 4],
              copy_proxy: [0.5, 0.5, 0.5],
              public_api: [2, 2, 2],
            },
          ],
        },
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
});

describe("summarizeVersions", () => {
  const target = (label, ratios, js = 2) => ({
    label,
    version: label,
    sessions: ratios.map((ratio, index) => ({
      index,
      sizes: { 1_000_000: { js_median: js, wasm_median: ratio * js } },
    })),
  });
  const config = { sessions: 1 };

  it("summarizes per-build ratio distributions", () => {
    const data = { config, targets: [target("chromium-1", [0.2, 0.3, 0.25])] };
    const { rows } = summarizeVersions(data);
    expect(rows[0].sessions).toBe(3);
    expect(rows[0].ratios).toEqual([0.2, 0.3, 0.25]);
  });

  it("detects adjacent-build steps in the js baseline", () => {
    const data = {
      config,
      targets: [target("chromium-1", [0.25], 6), target("chromium-2", [0.87], 2)],
    };
    const { steps } = summarizeVersions(data);
    expect(steps).toHaveLength(1);
    expect(steps[0].jsSpeedup).toBe(3);
    expect(steps[0].ratioBefore).toBe(0.25);
    expect(steps[0].ratioAfter).toBe(0.87);
  });

  it("rejects reproduction from BOTH sides of the prior band", () => {
    const data = {
      config,
      targets: [
        target("inside", [0.24, 0.26]),
        target("above", [0.85, 0.9]),
        target("below", [0.05, 0.1]),
      ],
    };
    const { reproduction } = summarizeVersions(data);
    expect(reproduction.map((v) => v.reproduces)).toEqual([true, false, false]);
  });

  it("skips builds with no sessions instead of crashing", () => {
    const data = {
      config,
      targets: [{ label: "dead", version: null, sessions: [] }, target("alive", [0.25])],
    };
    const { rows, steps, reproduction } = summarizeVersions(data);
    expect(rows[0].sessions).toBe(0);
    expect(steps).toHaveLength(0);
    expect(reproduction).toHaveLength(1);
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
