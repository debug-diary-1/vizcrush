import * as Plot from "@observablehq/plot";
import { init } from "@vizcrush/core";
import { lttb } from "@vizcrush/downsample";
import "./styles.css";

interface Point {
  x: number;
  y: number;
}

const POINT_COUNT = 1_000_000;
const threshold = document.querySelector<HTMLSelectElement>("#threshold")!;
const plotHost = document.querySelector<HTMLElement>("#plot")!;
const status = document.querySelector<HTMLElement>("#status")!;
const fields = {
  output: document.querySelector<HTMLElement>("#output")!,
  backend: document.querySelector<HTMLElement>("#backend")!,
  lttb: document.querySelector<HTMLElement>("#lttb-time")!,
  plot: document.querySelector<HTMLElement>("#plot-time")!,
};

function makeSeries(): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(POINT_COUNT);
  const y = new Float64Array(POINT_COUNT);
  for (let i = 0; i < POINT_COUNT; i += 1) {
    x[i] = i;
    y[i] = Math.sin(i / 13_000) * 20 + Math.sin(i / 913) * 4 + Math.cos(i / 97);
  }
  return { x, y };
}

const source = makeSeries();
let plottedPoints: Point[] = [];

function drawPlot(points: Point[]): void {
  if (points.length === 0) return;

  const plotStarted = performance.now();
  const chart = Plot.plot({
    width: Math.max(320, plotHost.clientWidth),
    height: 480,
    marginLeft: 58,
    marginBottom: 48,
    x: { label: "sample →", grid: true },
    y: { label: "↑ value", grid: true },
    marks: [Plot.ruleY([0]), Plot.lineY(points, { x: "x", y: "y", stroke: "#7656ff" })],
  });
  plotHost.replaceChildren(chart);
  fields.plot.textContent = `${(performance.now() - plotStarted).toFixed(1)} ms`;
}

async function reduceAndRender(): Promise<void> {
  threshold.disabled = true;
  const target = Number(threshold.value);
  status.textContent = `Reducing to ${target.toLocaleString()} points…`;
  const reduceStarted = performance.now();
  const reduced = await lttb(source.x, source.y, target);
  const reduceElapsed = performance.now() - reduceStarted;
  plottedPoints = Array.from(reduced.x, (x, index) => ({ x, y: reduced.y[index] }));
  drawPlot(plottedPoints);
  fields.output.textContent = reduced.x.length.toLocaleString();
  fields.lttb.textContent = `${reduceElapsed.toFixed(1)} ms`;
  status.textContent =
    "Timings cover only the named stages after one untimed real-input warm-up; startup is excluded.";
  threshold.disabled = false;
}

let resizeTimer = 0;
const observer = new ResizeObserver(() => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => drawPlot(plottedPoints), 120);
});

function reportError(error: unknown): void {
  status.textContent = `Plot pipeline failed: ${error instanceof Error ? error.message : String(error)}`;
  threshold.disabled = false;
}

threshold.addEventListener("change", () => void reduceAndRender().catch(reportError));

async function start(): Promise<void> {
  threshold.disabled = true;
  const context = await init();
  fields.backend.textContent = context.backend;
  status.textContent = "Warming LTTB on the real input…";
  await lttb(source.x, source.y, Number(threshold.value));
  await reduceAndRender();
  observer.observe(plotHost);
}

void start().catch(reportError);
