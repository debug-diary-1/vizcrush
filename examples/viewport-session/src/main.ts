import type { KernelBackend } from "@vizcrush/core";
import { TimeSeriesSession } from "@vizcrush/downsample/session";
import "./styles.css";

const POINT_COUNT = 1_000_000;
const session = new TimeSeriesSession({
  capacity: POINT_COUNT,
  maxOutputPoints: 20_000,
  pointsPerPixel: 1,
});
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

function makeSeries(): { x: Float64Array; y: Float64Array } {
  const x = new Float64Array(POINT_COUNT);
  const y = new Float64Array(POINT_COUNT);
  let state = 7;
  for (let index = 0; index < POINT_COUNT; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    x[index] = 1_700_000_000_000 + index * 100;
    y[index] =
      Math.sin(index / 7_000) * 16 + Math.sin(index / 311) * 2 + (state / 4_294_967_296 - 0.5);
  }
  return { x, y };
}

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
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = 480;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const context = canvas.getContext("2d")!;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const started = performance.now();
  const result = await session.view(
    {
      xMin: sourceX(domainMin),
      xMax: sourceX(domainMax),
      widthCssPixels: width,
      devicePixelRatio: dpr,
    },
    { backend: backend.value as KernelBackend },
  );
  draw(result.x, result.y, sourceX(domainMin), sourceX(domainMax), width, height);

  fields.retained.textContent = session.state.retainedPoints.toLocaleString();
  fields.visible.textContent = result.visiblePoints.toLocaleString();
  fields.output.textContent = `${result.x.length.toLocaleString()} / ${result.pointBudget.toLocaleString()}`;
  fields.actualBackend.textContent = result.backend ?? "no kernel";
  fields.reason.textContent = result.reason;
  fields.domain.textContent = `${domainMin.toLocaleString()}–${domainMax.toLocaleString()}`;
  status.textContent = `Rendered in the page's calling context in ${(performance.now() - started).toFixed(1)} ms. Result buffers are owned by the renderer.`;
}

function updateDomain(nextMin: number, nextMax: number): void {
  const span = Math.round(Math.min(POINT_COUNT - 1, Math.max(1, nextMax - nextMin)));
  domainMin = Math.max(0, Math.min(POINT_COUNT - 1 - span, Math.round(nextMin)));
  domainMax = domainMin + span;
  void render();
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
backend.addEventListener("change", () => void render());

async function initialize(): Promise<void> {
  const input = makeSeries();
  session.load(input.x, input.y);
  await render();
  new ResizeObserver(() => void render()).observe(canvas);
}

void initialize();
