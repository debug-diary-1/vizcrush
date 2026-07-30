/**
 * JS↔WASM boundary-copy benchmark (issue #37, step 1).
 *
 * Goal: quantify what fraction of a real WASM-backed call is spent copying the
 * input typed arrays across the boundary, so we know the *ceiling* on any
 * "allocate-in-wasm-heap" optimization before building it.
 *
 * The inbound copy is exactly what wasm-bindgen's `passArrayF64ToWasm0` does:
 *     const ptr = malloc(arg.length * 8, 8);
 *     getFloat64ArrayMemory0().set(arg, ptr / 8);   // <-- memcpy of n*8 bytes
 * i.e. a `Float64Array.prototype.set` into linear memory. We measure that exact
 * memcpy (into a pre-allocated destination of the same size) as the proxy for
 * the per-call inbound copy, and compare it to the full wasm call.
 *
 * Run: node --experimental-strip-types benchmarks/wasm-boundary.bench.ts
 */

import { lttb, lttbSync } from "@vizcrush/downsample";
import { bin2d, bin2dCore } from "@vizcrush/bin";
import { buildQuadtree, buildQuadtreeSync } from "@vizcrush/spatial";

const SIZES = [10_000, 100_000, 1_000_000, 10_000_000];
const TARGET = 1_000;

function gen(n: number): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    x[i] = i;
    v += (Math.random() - 0.498) * 10;
    y[i] = v;
  }
  return { x, y };
}

function median(times: number[]): number {
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function timeAsync(fn: () => Promise<unknown>, runs: number): Promise<number> {
  for (let i = 0; i < 3; i++) await fn(); // warmup
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    t.push(performance.now() - t0);
  }
  return median(t);
}

function timeSync(fn: () => void, runs: number): number {
  for (let i = 0; i < 3; i++) fn(); // warmup
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  return median(t);
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

interface Row {
  algo: string;
  size: number;
  wasmFull: number;
  jsCore: number;
  copyIn: number;
  fraction: number;
  wasmVsJs: number; // wasmFull / jsCore  (<1 means wasm is faster)
}

// Each algo: a wasm-backed async call (forced 'wasm'), the equivalent sync JS
// core, and the inbound copy (the typed arrays it must push across the boundary).
const ALGOS = [
  {
    name: "lttb",
    copies: 2,
    wasm: (x: Float64Array, y: Float64Array) => lttb(x, y, TARGET, { backend: "wasm" }),
    js: (x: Float64Array, y: Float64Array) => void lttbSync(x, y, TARGET),
  },
  {
    name: "bin2d",
    copies: 2,
    wasm: (x: Float64Array, y: Float64Array) => bin2d(x, y, {}, { backend: "wasm" }),
    js: (x: Float64Array, y: Float64Array) => void bin2dCore(x, y, 256, 256, NaN, NaN, NaN, NaN),
  },
  {
    name: "buildQuadtree",
    copies: 2,
    wasm: (x: Float64Array, y: Float64Array) => buildQuadtree(x, y, { backend: "wasm" }),
    js: (x: Float64Array, y: Float64Array) => void buildQuadtreeSync(x, y),
  },
];

console.log("JS↔WASM boundary-copy benchmark (#37)\n");
console.log(`platform: ${process.platform} ${process.arch}  node: ${process.version}\n`);
console.log(
  ["algo", "size", "wasm full", "js core", "copy-in", "copy/wasm", "wasm/js"]
    .map((s) => s.padEnd(13))
    .join(""),
);
console.log("-".repeat(91));

const rows: Row[] = [];

for (const algo of ALGOS) {
  for (const n of SIZES) {
    const { x, y } = gen(n);
    const dests = Array.from({ length: algo.copies }, () => new Float64Array(n));
    const srcs = [x, y];
    const runs = n >= 5_000_000 ? 15 : n >= 1_000_000 ? 40 : 100;

    const wasmFull = await timeAsync(() => algo.wasm(x, y), runs);
    const jsCore = timeSync(() => algo.js(x, y), runs);
    const copyIn = timeSync(() => {
      for (let i = 0; i < algo.copies; i++) dests[i].set(srcs[i]);
    }, runs);

    const fraction = copyIn / wasmFull;
    const wasmVsJs = wasmFull / jsCore;
    rows.push({ algo: algo.name, size: n, wasmFull, jsCore, copyIn, fraction, wasmVsJs });

    console.log(
      [
        algo.name,
        n.toLocaleString(),
        fmt(wasmFull),
        fmt(jsCore),
        fmt(copyIn),
        `${(fraction * 100).toFixed(1)}%`,
        `${wasmVsJs.toFixed(2)}×`,
      ]
        .map((s) => s.padEnd(13))
        .join(""),
    );
  }
  console.log("-".repeat(91));
}

console.log("\n--- Verdict ---");
console.log("go/no-go bar: copy ≥15% of the wasm call at ≥1M points\n");
for (const algo of ALGOS) {
  const big = rows.filter((r) => r.algo === algo.name && r.size >= 1_000_000);
  const maxFrac = Math.max(...big.map((r) => r.fraction));
  const meanWasmVsJs = big.reduce((s, r) => s + r.wasmVsJs, 0) / big.length;
  const wasmHelps = meanWasmVsJs < 0.85; // wasm at least 15% faster than the JS core
  console.log(
    `${algo.name.padEnd(15)} copy@≥1M max ${(maxFrac * 100).toFixed(1).padStart(5)}%  ` +
      `wasm/js ${meanWasmVsJs.toFixed(2)}×  → ` +
      (maxFrac >= 0.15
        ? wasmHelps
          ? "copy is real overhead AND wasm beats js: prototype A worthwhile"
          : "copy is real overhead BUT wasm≈js — removing copy only matters in buffer-reuse"
        : "copy below bar — not worth pursuing"),
  );
}
console.log(
  "\nNote: the inbound copy is unavoidable for one-shot calls whose data\n" +
    "originates on the JS heap. Prototype A only removes it when the caller\n" +
    "writes data straight into a reused wasm-heap buffer (streaming / per-frame).",
);
