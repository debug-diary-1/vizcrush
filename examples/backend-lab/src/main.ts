/**
 * Backend Lab.
 *
 * The library's public claim is narrow on purpose: WASM is substantially faster
 * than the JS core in Chromium/V8, comparable-to-slower in Firefox and Safari,
 * and which one wins is workload- and engine-dependent (ADR 0003). That is an
 * awkward thing to assert in a README, because the reader has no way to check
 * it. This page lets them check it, on their own machine, in their own engine,
 * in about ten seconds.
 *
 * It runs the real LTTB kernel on both backends over the same input, reports a
 * distribution rather than a single number, and refuses to render while it
 * measures.
 *
 * The one thing a page like this must never do is quietly compare a backend
 * with itself. `lttb(..., { backend: "wasm" })` falls back to the JS core when
 * the WASM module cannot be loaded, which is the right behaviour for a library
 * and a disaster for a benchmark. So every call goes through
 * `downsampleKernels.lttb.withBackend`, which reports the path that actually
 * ran, and the UI shows that rather than what was requested.
 */
import { detectCapabilities } from "@vizcrush/core";
import { downsampleKernels } from "@vizcrush/downsample";
import { generateSeries, type Series } from "./data.js";
import { renderChart } from "./chart.js";
import { formatMs, measure, stability, type Timing } from "./measure.js";

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const canvas = el<HTMLCanvasElement>("chart");
const sizeSelect = el<HTMLSelectElement>("size");
const targetSelect = el<HTMLSelectElement>("target");
const runButton = el<HTMLButtonElement>("run");
const statusEl = el("status");
const resultsEl = el("results");
const capsEl = el("caps");
const verdictEl = el("verdict");

const lttbKernel = downsampleKernels.lttb;

let series: Series | null = null;
let currentSize = 0;

function setStatus(message: string, busy = false): void {
  statusEl.textContent = message;
  statusEl.dataset.busy = busy ? "true" : "false";
}

async function drawPreview(target: number): Promise<void> {
  if (!series) return;
  const { result } = await lttbKernel.withBackend(series.x, series.y, target, { backend: "js" });
  renderChart(canvas, result.x, result.y);
}

function ensureSeries(size: number): void {
  if (series && currentSize === size) return;
  setStatus(`generating ${size.toLocaleString()} points…`, true);
  series = generateSeries(size);
  currentSize = size;
}

function row(label: string, timing: Timing, baseline?: Timing): string {
  const s = stability(timing);
  const ratio =
    baseline && timing.median > 0 ? `${(baseline.median / timing.median).toFixed(2)}x` : "—";
  return `
    <tr>
      <td class="backend">${label}</td>
      <td class="num">${formatMs(timing.median)}</td>
      <td class="num dim">${formatMs(timing.min)}</td>
      <td class="num dim">${formatMs(timing.max)}</td>
      <td class="num"><span class="tag ${s.label}">${s.label}</span></td>
      <td class="num">${ratio}</td>
    </tr>`;
}

function engineName(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Firefox")) return "Firefox/SpiderMonkey";
  if (ua.includes("Chrome") || ua.includes("Chromium")) return "Chromium/V8";
  if (ua.includes("Safari")) return "Safari/JavaScriptCore";
  return "this engine";
}

/**
 * Turns the two timings into a sentence that does not overclaim. Anything
 * inside the noise floor is a tie, because "1.04x faster" from seven samples
 * is not a finding.
 */
function verdict(js: Timing, wasm: Timing): string {
  const ratio = js.median / wasm.median;
  const noisy = stability(js).spreadPct > 50 || stability(wasm).spreadPct > 50;
  const engine = engineName();

  if (noisy) {
    return "Readings are unstable on this machine, so treat the ratio as indicative only. Close other tabs and run again for a cleaner number.";
  }
  if (ratio > 1.15) {
    return `WASM is about ${ratio.toFixed(1)}x faster than the JS core here, on ${engine}. That is the case the library optimises for.`;
  }
  if (ratio < 0.87) {
    return `The JS core is about ${(1 / ratio).toFixed(1)}x faster than WASM here, on ${engine}. This is expected on some engines and is why WASM is never claimed to be a universal win.`;
  }
  return `The two backends are within noise of each other on ${engine}: no meaningful difference at this size.`;
}

async function run(): Promise<void> {
  const size = Number(sizeSelect.value);
  const target = Number(targetSelect.value);

  runButton.disabled = true;
  resultsEl.innerHTML = "";
  verdictEl.textContent = "";

  try {
    ensureSeries(size);
    const { x, y } = series!;

    // Draw once up front, then leave the canvas alone. Nothing repaints while
    // the timings below are collected.
    setStatus("rendering preview…", true);
    await drawPreview(target);

    // Establish which path each request actually resolves to, before timing.
    const jsProbe = await lttbKernel.withBackend(x, y, target, { backend: "js" });
    const wasmProbe = await lttbKernel.withBackend(x, y, target, { backend: "wasm" });

    if (wasmProbe.backend !== "wasm") {
      resultsEl.innerHTML = `<p class="agreement">
        Requested the WASM backend and got <strong>${wasmProbe.backend}</strong>: the module could
        not be loaded here, so there is nothing to compare. Timing both paths now would report a
        difference between the JS core and itself.
      </p>`;
      setStatus("WASM unavailable in this environment — comparison skipped.");
      return;
    }

    setStatus("measuring JS core (rendering paused)…", true);
    const js = await measure(() => lttbKernel.withBackend(x, y, target, { backend: "js" }));

    setStatus("measuring WASM (rendering paused)…", true);
    const wasm = await measure(() => lttbKernel.withBackend(x, y, target, { backend: "wasm" }));

    // A faster wrong answer is not a faster answer.
    const jsOut = jsProbe.result;
    const wasmOut = wasmProbe.result;
    const sameLength = jsOut.x.length === wasmOut.x.length;
    let maxDelta = 0;
    if (sameLength) {
      for (let i = 0; i < jsOut.y.length; i++) {
        maxDelta = Math.max(maxDelta, Math.abs(jsOut.y[i]! - wasmOut.y[i]!));
      }
    }

    resultsEl.innerHTML = `
      <table>
        <thead>
          <tr><th>backend (as run)</th><th>median</th><th>min</th><th>max</th><th>spread</th><th>vs JS</th></tr>
        </thead>
        <tbody>
          ${row(jsProbe.backend, js)}
          ${row(wasmProbe.backend, wasm, js)}
        </tbody>
      </table>
      <p class="agreement">
        ${
          sameLength
            ? `Both backends returned ${jsOut.x.length.toLocaleString()} points; largest difference between them: ${maxDelta === 0 ? "0 (identical)" : maxDelta.toExponential(2)}.`
            : `Backends disagreed on output length (${jsOut.x.length} vs ${wasmOut.x.length}). That is a bug worth reporting.`
        }
      </p>`;

    verdictEl.textContent = verdict(js, wasm);
    setStatus(
      `${size.toLocaleString()} points reduced to ${target.toLocaleString()} — ${(size / target).toFixed(0)}x fewer points to draw.`,
    );
  } catch (error) {
    setStatus(`failed: ${(error as Error).message}`);
  } finally {
    runButton.disabled = false;
  }
}

async function main(): Promise<void> {
  // detectCapabilities is async: it awaits a real WebGPU adapter request rather
  // than sniffing for the property. Reading it synchronously yields a Promise
  // and reports every capability as absent.
  const caps = await detectCapabilities();
  capsEl.innerHTML = (
    [
      ["wasm", caps.wasm],
      ["wasm simd", caps.wasmSimd],
      ["webgpu", caps.webgpu],
      ["sharedArrayBuffer", caps.sharedArrayBuffer],
    ] as const
  )
    .map(
      ([name, on]) => `<span class="cap ${on ? "on" : "off"}">${name}: ${on ? "yes" : "no"}</span>`,
    )
    .join("");

  runButton.addEventListener("click", () => void run());
  sizeSelect.addEventListener("change", () => {
    ensureSeries(Number(sizeSelect.value));
    void drawPreview(Number(targetSelect.value));
    setStatus("ready");
  });
  targetSelect.addEventListener("change", () => void drawPreview(Number(targetSelect.value)));
  window.addEventListener("resize", () => void drawPreview(Number(targetSelect.value)));

  ensureSeries(Number(sizeSelect.value));
  await drawPreview(Number(targetSelect.value));
  setStatus("ready");
}

void main();
