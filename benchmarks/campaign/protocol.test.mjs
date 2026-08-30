import { describe, expect, it } from "vitest";
import {
  REPS,
  SEED,
  SIZES,
  THRESHOLD,
  WARMUPS,
  assertParity,
  makeSeries,
  measure,
  measureAsync,
  mulberry32,
  sinkValue,
  timeBlock,
} from "./protocol.mjs";

describe("campaign configuration", () => {
  it("pins the published protocol constants", () => {
    expect(THRESHOLD).toBe(1000);
    expect(SEED).toBe(42);
    expect(REPS).toBe(15);
    expect(WARMUPS).toBe(3);
    expect(SIZES.map((s) => s.n)).toEqual([100_000, 1_000_000]);
    for (const size of SIZES) {
      expect(Number.isInteger(size.calls) && size.calls > 0).toBe(true);
      expect(Number.isInteger(size.asyncCalls) && size.asyncCalls > 0).toBe(true);
    }
  });
});

describe("mulberry32 / makeSeries", () => {
  it("produces the same stream for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i += 1) expect(a()).toBe(b());
  });

  it("builds a deterministic series with monotone x", () => {
    const first = makeSeries(64, SEED);
    const second = makeSeries(64, SEED);
    expect([...first.x]).toEqual([...second.x]);
    expect([...first.y]).toEqual([...second.y]);
    for (let i = 0; i < 64; i += 1) expect(first.x[i]).toBe(i);
    const other = makeSeries(64, SEED + 1);
    expect([...other.y]).not.toEqual([...first.y]);
  });
});

describe("timing loops and the benchmark sink", () => {
  it("invokes the callback exactly `calls` times and consumes its result", () => {
    let invocations = 0;
    const before = sinkValue();
    const perCall = timeBlock(() => {
      invocations += 1;
      return 2;
    }, 7);
    expect(invocations).toBe(7);
    expect(sinkValue() - before).toBe(14);
    expect(perCall).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(perCall)).toBe(true);
  });

  it("measure runs warmups untimed and returns one sample per rep", () => {
    let invocations = 0;
    const samples = measure(
      () => {
        invocations += 1;
        return 1;
      },
      { calls: 5, reps: 4, warmups: 2 },
    );
    expect(samples).toHaveLength(4);
    expect(invocations).toBe((4 + 2) * 5);
  });

  it("measureAsync consumes resolved results the same way", async () => {
    const before = sinkValue();
    const samples = await measureAsync(() => Promise.resolve(3), {
      calls: 2,
      reps: 3,
      warmups: 1,
    });
    expect(samples).toHaveLength(3);
    expect(sinkValue() - before).toBe((3 + 1) * 2 * 3);
  });
});

describe("assertParity", () => {
  const jsOut = { x: Float64Array.of(0, 1, 2), y: Float64Array.of(5, 6, 7) };
  const interleave = ({ x, y }) => {
    const out = new Float64Array(x.length * 2);
    for (let i = 0; i < x.length; i += 1) {
      out[i * 2] = x[i];
      out[i * 2 + 1] = y[i];
    }
    return out;
  };

  it("returns 0 for exactly matching outputs", () => {
    expect(assertParity(interleave(jsOut), jsOut)).toBe(0);
  });

  it("rejects differing output lengths", () => {
    expect(() => assertParity(interleave(jsOut).subarray(0, 4), jsOut)).toThrow(
      /parity gate.*lengths differ/u,
    );
  });

  it("rejects any nonzero difference", () => {
    const wasmOut = interleave(jsOut);
    wasmOut[3] += 1e-9;
    expect(() => assertParity(wasmOut, jsOut)).toThrow(/parity gate.*outputs differ/u);
  });

  it("rejects non-finite differences instead of serializing them", () => {
    const nanOut = interleave(jsOut);
    nanOut[2] = Number.NaN;
    expect(() => assertParity(nanOut, jsOut)).toThrow(/parity gate.*non-finite/u);

    const infOut = interleave(jsOut);
    infOut[0] = Number.POSITIVE_INFINITY;
    expect(() => assertParity(infOut, jsOut)).toThrow(/parity gate.*non-finite/u);
  });

  it("rejects mismatched x/y lengths in the JS output", () => {
    const ragged = { x: Float64Array.of(0, 1), y: Float64Array.of(5) };
    expect(() => assertParity(Float64Array.of(0, 5, 1, 6), ragged)).toThrow(
      /parity gate.*x\/y lengths/u,
    );
  });
});
