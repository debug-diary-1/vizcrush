import type { KernelBackend } from "@vizcrush/core";
import {
  TimeSeriesWorkerBusyError,
  TimeSeriesWorkerClient,
} from "@vizcrush/downsample/worker-client";
import "./styles.css";

const POINT_COUNT = 1_000_000;
const canvas = document.querySelector<HTMLCanvasElement>("#chart")!;
const backend = document.querySelector<HTMLSelectElement>("#backend")!;
const status = document.querySelector<HTMLElement>("#status")!;
const fields = {
  retained: document.querySelector<HTMLElement>("#retained")!,
  visible: document.querySelector<HTMLElement>("#visible")!,
  output: document.querySelector<HTMLElement>("#output")!,
  actualBackend: document.querySelector<HTMLElement>("#actual-backend")!,
  reason: document.querySelector<HTMLElement>("#reason")!,
  domain: document.querySelector<HTMLElement>("#domain")!,
};

let domainMin = 0;
let domainMax = POINT_COUNT - 1;
let client: TimeSeriesWorkerClient | null = null;

function sourceX(index: number): number {
  return 1_700_000_000_000 + index * 100;
}

function draw(
  x: Float64Array,
  y: Float64Array,
  xMin: number,
  xMax: number,
  width: number,
  height: number,
): void {
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#071412";
  context.fillRect(0, 0, width, height);
  if (x.length === 0) return;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const value of y) {
    yMin = Math.min(yMin, value);
    yMax = Math.max(yMax, value);
  }
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  context.strokeStyle = "#55d6be";
  context.lineWidth = 1.5;
  context.beginPath();
  for (let index = 0; index < x.length; index += 1) {
    const px = xSpan === 0 ? width / 2 : ((x[index] - xMin) / xSpan) * width;
    const py = ySpan === 0 ? height / 2 : height - ((y[index] - yMin) / ySpan) * height;
    if (index === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.stroke();
}

async function render(): Promise<void> {
  if (!client) throw new Error("Worker is not ready");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = 480;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d")!;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const started = performance.now();
  const { value: result } = await client.view(
    {
      xMin: sourceX(domainMin),
      xMax: sourceX(domainMax),
      widthCssPixels: width,
      devicePixelRatio: dpr,
    },
    { backend: backend.value as KernelBackend },
  );
  draw(result.x, result.y, sourceX(domainMin), sourceX(domainMax), width, height);

  fields.visible.textContent = result.visiblePoints.toLocaleString();
  fields.output.textContent = `${result.x.length.toLocaleString()} / ${result.pointBudget.toLocaleString()}`;
  fields.actualBackend.textContent = result.backend ?? "no kernel";
  fields.reason.textContent = result.reason;
  fields.domain.textContent = `${domainMin.toLocaleString()}–${domainMax.toLocaleString()}`;
  status.textContent = `Worker round trip and page rendering completed in ${(performance.now() - started).toFixed(1)} ms. Result buffers are owned by the renderer.`;
}

function updateDomain(nextMin: number, nextMax: number): void {
  const span = Math.round(Math.min(POINT_COUNT - 1, Math.max(1, nextMax - nextMin)));
  domainMin = Math.max(0, Math.min(POINT_COUNT - 1 - span, Math.round(nextMin)));
  domainMax = domainMin + span;
  void render().catch(showWorkerError);
}

function showWorkerError(error: unknown): void {
  status.textContent =
    error instanceof TimeSeriesWorkerBusyError
      ? "Worker busy: this slice rejects overlapping navigation explicitly."
      : `Worker error: ${error instanceof Error ? error.message : String(error)}`;
}

document.querySelector("#pan-left")!.addEventListener("click", () => {
  const shift = (domainMax - domainMin) * 0.2;
  updateDomain(domainMin - shift, domainMax - shift);
});
document.querySelector("#pan-right")!.addEventListener("click", () => {
  const shift = (domainMax - domainMin) * 0.2;
  updateDomain(domainMin + shift, domainMax + shift);
});
document.querySelector("#zoom-in")!.addEventListener("click", () => {
  const center = (domainMin + domainMax) / 2;
  const half = (domainMax - domainMin) / 4;
  updateDomain(center - half, center + half);
});
document.querySelector("#zoom-out")!.addEventListener("click", () => {
  const center = (domainMin + domainMax) / 2;
  const half = domainMax - domainMin;
  updateDomain(center - half, center + half);
});
document.querySelector("#reset")!.addEventListener("click", () => {
  updateDomain(0, POINT_COUNT - 1);
});
backend.addEventListener("change", () => void render().catch(showWorkerError));

async function initialize(): Promise<void> {
  status.textContent = "Generating and retaining 1,000,000 points in one persistent worker…";
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  client = new TimeSeriesWorkerClient(worker);
  const { value: state } = await client.state();
  fields.retained.textContent = state.retainedPoints.toLocaleString();
  await render();
  new ResizeObserver(() => void render().catch(showWorkerError)).observe(canvas);
}

window.addEventListener("pagehide", () => void client?.dispose(), { once: true });
void initialize().catch(showWorkerError);
