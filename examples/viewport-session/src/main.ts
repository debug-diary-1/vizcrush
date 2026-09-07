import type { KernelBackend } from "@vizcrush/core";
import type { TimeSeriesSessionState } from "@vizcrush/downsample/session";
import {
  TimeSeriesWorkerBusyError,
  TimeSeriesWorkerClient,
  TimeSeriesWorkerSupersededError,
} from "@vizcrush/downsample/worker-client";
import "./styles.css";

const RETENTION_CAPACITY = 1_000_000;
const INITIAL_POINT_COUNT = RETENTION_CAPACITY;
const STREAM_BATCH_POINTS = 4_096;
const STREAM_INTERVAL_MS = 250;
const INITIAL_VIEW_POINTS = 100_000;
const SOURCE_START = 1_700_000_000_000;
const SOURCE_STEP_MS = 100;

const canvas = document.querySelector<HTMLCanvasElement>("#chart")!;
const backend = document.querySelector<HTMLSelectElement>("#backend")!;
const status = document.querySelector<HTMLElement>("#status")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const followButton = document.querySelector<HTMLButtonElement>("#follow")!;
const fields = {
  retained: document.querySelector<HTMLElement>("#retained")!,
  progress: document.querySelector<HTMLElement>("#progress")!,
  buffers: document.querySelector<HTMLElement>("#buffers")!,
  visible: document.querySelector<HTMLElement>("#visible")!,
  output: document.querySelector<HTMLElement>("#output")!,
  actualBackend: document.querySelector<HTMLElement>("#actual-backend")!,
  reason: document.querySelector<HTMLElement>("#reason")!,
  domain: document.querySelector<HTMLElement>("#domain")!,
};

let domainMin = INITIAL_POINT_COUNT - INITIAL_VIEW_POINTS;
let domainMax = INITIAL_POINT_COUNT - 1;
let nextSourceIndex = INITIAL_POINT_COUNT;
let client: TimeSeriesWorkerClient | null = null;
let streamTimer: number | null = null;
let appendPending = false;
let paused = false;
let followLatest = true;
let runIdentity = 0;

function sourceX(index: number): number {
  return SOURCE_START + index * SOURCE_STEP_MS;
}

function sourceY(index: number): number {
  const noise = ((Math.imul(index ^ 0x9e3779b9, 1_664_525) + 1_013_904_223) >>> 0) / 4_294_967_296;
  return Math.sin(index / 7_000) * 16 + Math.sin(index / 311) * 2 + noise - 0.5;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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

function updateState(nextState: TimeSeriesSessionState): void {
  fields.retained.textContent = `${nextState.retainedPoints.toLocaleString()} / ${nextState.capacity.toLocaleString()}`;
  fields.progress.textContent = `${nextSourceIndex.toLocaleString()} total · rev ${nextState.sourceRevision}`;
  fields.buffers.textContent = `${formatBytes(nextState.bufferBytes.retainedSourceBytes)} retained · ${formatBytes(nextState.bufferBytes.totalAccountedCapacityBytes)} max accounted`;
}

async function render(): Promise<void> {
  const currentClient = client;
  if (!currentClient) throw new Error("Worker is not ready");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = 480;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);

  const started = performance.now();
  const { value: result } = await currentClient.view(
    {
      xMin: sourceX(domainMin),
      xMax: sourceX(domainMax),
      widthCssPixels: width,
      devicePixelRatio: dpr,
    },
    { backend: backend.value as KernelBackend },
  );
  if (currentClient !== client) return;
  draw(result.x, result.y, sourceX(domainMin), sourceX(domainMax), width, height);

  fields.visible.textContent = result.visiblePoints.toLocaleString();
  fields.output.textContent = `${result.x.length.toLocaleString()} / ${result.pointBudget.toLocaleString()} · ${formatBytes(result.outputBytes)}`;
  fields.actualBackend.textContent = result.backend ?? "no kernel";
  fields.reason.textContent = result.reason;
  fields.domain.textContent = `${domainMin.toLocaleString()}–${domainMax.toLocaleString()}`;
  const rangeMessage =
    result.visiblePoints === 0
      ? " The inspected domain has been evicted; only a continuity neighbor may remain."
      : "";
  status.textContent = `Revision ${result.sourceRevision} rendered in ${(performance.now() - started).toFixed(1)} ms.${rangeMessage}`;
}

function setFollowLatest(enabled: boolean): void {
  followLatest = enabled;
  followButton.setAttribute("aria-pressed", String(enabled));
  followButton.textContent = enabled ? "Following latest" : "Follow latest";
}

function setPaused(enabled: boolean): void {
  paused = enabled;
  pauseButton.setAttribute("aria-pressed", String(enabled));
  pauseButton.textContent = enabled
    ? appendPending
      ? "Pausing after current batch…"
      : "Resume stream"
    : "Pause stream";
  if (enabled && appendPending) {
    status.textContent = "Pausing after the already transferred batch is acknowledged.";
  }
}

function updateDomain(nextMin: number, nextMax: number, manual = true): void {
  const latest = Math.max(1, nextSourceIndex - 1);
  const span = Math.round(Math.min(latest, Math.max(1, nextMax - nextMin)));
  domainMin = Math.max(0, Math.min(latest - span, Math.round(nextMin)));
  domainMax = domainMin + span;
  if (manual) setFollowLatest(false);
  void render().catch(showWorkerError);
}

function showWorkerError(error: unknown): void {
  if (error instanceof TimeSeriesWorkerSupersededError) return;
  status.textContent =
    error instanceof TimeSeriesWorkerBusyError
      ? "Backpressure: one append is already awaiting acknowledgement; input ownership was preserved."
      : `Worker error: ${error instanceof Error ? error.message : String(error)}`;
}

async function appendNextBatch(expectedRunIdentity: number): Promise<void> {
  if (paused || appendPending || !client || expectedRunIdentity !== runIdentity) return;
  appendPending = true;
  const batchStart = nextSourceIndex;
  const x = new Float64Array(STREAM_BATCH_POINTS);
  const y = new Float64Array(STREAM_BATCH_POINTS);
  for (let index = 0; index < STREAM_BATCH_POINTS; index += 1) {
    const source = batchStart + index;
    x[index] = sourceX(source);
    y[index] = sourceY(source);
  }
  try {
    const currentClient = client;
    const { value } = await currentClient.append(x, y, { transfer: true });
    if (expectedRunIdentity !== runIdentity || currentClient !== client) return;
    nextSourceIndex += STREAM_BATCH_POINTS;
    updateState(value);
    if (followLatest) {
      const span = domainMax - domainMin;
      domainMax = nextSourceIndex - 1;
      domainMin = domainMax - span;
    }
    await render();
  } catch (error) {
    showWorkerError(error);
  } finally {
    appendPending = false;
    if (paused) setPaused(true);
  }
}

function startStream(expectedRunIdentity: number): void {
  if (streamTimer !== null) window.clearInterval(streamTimer);
  streamTimer = window.setInterval(
    () => void appendNextBatch(expectedRunIdentity),
    STREAM_INTERVAL_MS,
  );
}

async function resetScenario(): Promise<void> {
  const expectedRunIdentity = ++runIdentity;
  if (streamTimer !== null) window.clearInterval(streamTimer);
  streamTimer = null;
  appendPending = false;
  await client?.dispose();
  if (expectedRunIdentity !== runIdentity) return;
  client = null;
  nextSourceIndex = INITIAL_POINT_COUNT;
  domainMin = INITIAL_POINT_COUNT - INITIAL_VIEW_POINTS;
  domainMax = INITIAL_POINT_COUNT - 1;
  setPaused(false);
  setFollowLatest(true);
  status.textContent = "Generating and retaining 1,000,000 points in one persistent worker…";
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const nextClient = new TimeSeriesWorkerClient(worker);
  client = nextClient;
  const { value } = await nextClient.state();
  if (expectedRunIdentity !== runIdentity) return;
  updateState(value);
  await render();
  startStream(expectedRunIdentity);
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
pauseButton.addEventListener("click", () => setPaused(!paused));
followButton.addEventListener("click", () => {
  setFollowLatest(true);
  const span = domainMax - domainMin;
  updateDomain(nextSourceIndex - 1 - span, nextSourceIndex - 1, false);
});
document.querySelector("#reset")!.addEventListener("click", () => void resetScenario());
backend.addEventListener("change", () => void render().catch(showWorkerError));
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const control =
    event.key === "ArrowLeft"
      ? "#pan-left"
      : event.key === "ArrowRight"
        ? "#pan-right"
        : event.key === "+" || event.key === "="
          ? "#zoom-in"
          : event.key === "-"
            ? "#zoom-out"
            : event.key.toLowerCase() === "f"
              ? "#follow"
              : event.key === " "
                ? "#pause"
                : event.key === "0"
                  ? "#reset"
                  : null;
  if (!control) return;
  event.preventDefault();
  document.querySelector<HTMLButtonElement>(control)!.click();
});

window.addEventListener(
  "pagehide",
  () => {
    if (streamTimer !== null) window.clearInterval(streamTimer);
    void client?.dispose();
  },
  { once: true },
);
new ResizeObserver(() => {
  if (client) void render().catch(showWorkerError);
}).observe(canvas);
void resetScenario().catch(showWorkerError);
