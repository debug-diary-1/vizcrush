import type { KernelBackend } from "@vizcrush/core";
import type { TimeSeriesSessionState } from "@vizcrush/downsample/session";
import {
  TimeSeriesWorkerBusyError,
  TimeSeriesWorkerClient,
  TimeSeriesWorkerSupersededError,
} from "@vizcrush/downsample/worker-client";
import {
  compareOutputs,
  DOWNSAMPLE_PACKAGE_VERSION,
  downloadScenarioReport,
  startFrameGapRecording,
  summarizeMeasurements,
  type AppendMeasurement,
  type InitializationMeasurement,
  type ScenarioReport,
  type ViewMeasurement,
} from "./scenario";
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
const scenarioButton = document.querySelector<HTMLButtonElement>("#run-scenario")!;
const exportButton = document.querySelector<HTMLButtonElement>("#export-results")!;
const scenarioStatus = document.querySelector<HTMLElement>("#scenario-status")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset")!;
const viewportControls = Array.from(
  document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
    '.controls[aria-label="Viewport controls"] button, .controls[aria-label="Viewport controls"] select',
  ),
);
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
let appendWork: Promise<void> | null = null;
let paused = false;
let followLatest = true;
let runIdentity = 0;
let sessionState: TimeSeriesSessionState | null = null;
let initializationMeasurement: InitializationMeasurement | null = null;
let latestScenarioReport: ScenarioReport | null = null;
let scenarioRunning = false;

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
  sessionState = nextState;
  fields.retained.textContent = `${nextState.retainedPoints.toLocaleString()} / ${nextState.capacity.toLocaleString()}`;
  fields.progress.textContent = `${nextSourceIndex.toLocaleString()} total · rev ${nextState.sourceRevision}`;
  fields.buffers.textContent = `${formatBytes(nextState.bufferBytes.retainedSourceBytes)} retained · ${formatBytes(nextState.bufferBytes.totalAccountedCapacityBytes)} max accounted`;
}

async function requestAndRender(
  requestedBackend: KernelBackend,
  phase: ViewMeasurement["phase"],
  widthOverride?: number,
): Promise<{ measurement: ViewMeasurement; x: Float64Array; y: Float64Array }> {
  const currentClient = client;
  if (!currentClient) throw new Error("Worker is not ready");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = widthOverride ?? Math.max(1, rect.width);
  const height = 480;
  const renderWidth = Math.max(1, rect.width);
  canvas.width = Math.round(renderWidth * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);

  const started = performance.now();
  const response = await currentClient.view(
    {
      xMin: sourceX(domainMin),
      xMax: sourceX(domainMax),
      widthCssPixels: width,
      devicePixelRatio: dpr,
    },
    { backend: requestedBackend },
  );
  const responseAt = performance.now();
  const result = response.value;
  if (currentClient !== client) throw new Error("Worker changed before the viewport could render");
  canvas.dataset.viewportId = String(response.viewportId);
  canvas.dataset.sourceRevision = String(result.sourceRevision);
  canvas.dataset.domainMin = String(domainMin);
  canvas.dataset.domainMax = String(domainMax);
  draw(result.x, result.y, sourceX(domainMin), sourceX(domainMax), renderWidth, height);
  const completedAt = performance.now();

  fields.visible.textContent = result.visiblePoints.toLocaleString();
  fields.output.textContent = `${result.x.length.toLocaleString()} / ${result.pointBudget.toLocaleString()} · ${formatBytes(result.outputBytes)}`;
  fields.actualBackend.textContent = result.backend ?? "no kernel";
  fields.reason.textContent = result.reason;
  fields.domain.textContent = `${domainMin.toLocaleString()}–${domainMax.toLocaleString()}`;
  const rangeMessage =
    result.visiblePoints === 0
      ? " The inspected domain has been evicted; only a continuity neighbor may remain."
      : "";
  status.textContent = `Revision ${result.sourceRevision} rendered in ${(completedAt - started).toFixed(1)} ms.${rangeMessage}`;
  return {
    measurement: {
      phase,
      label: phase === "warmup" ? "warmup" : "warm",
      requestedBackend,
      actualBackend: result.backend,
      reason: result.reason,
      sourceRevision: result.sourceRevision,
      domain: { xMin: sourceX(domainMin), xMax: sourceX(domainMax) },
      widthCssPixels: width,
      outputPoints: result.x.length,
      workerProcessingMs: response.workerProcessingMs,
      roundTripMs: responseAt - started,
      callerToRenderCompletionMs: completedAt - started,
      rendererMs: completedAt - responseAt,
    },
    x: result.x,
    y: result.y,
  };
}

async function render(): Promise<void> {
  await requestAndRender(backend.value as KernelBackend, "viewport");
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

function createBatch(
  start: number,
  length = STREAM_BATCH_POINTS,
): {
  x: Float64Array;
  y: Float64Array;
} {
  const x = new Float64Array(length);
  const y = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    const source = start + index;
    x[index] = sourceX(source);
    y[index] = sourceY(source);
  }
  return { x, y };
}

async function appendNextBatch(expectedRunIdentity: number): Promise<void> {
  if (paused || appendPending || !client || expectedRunIdentity !== runIdentity) return;
  appendPending = true;
  const batchStart = nextSourceIndex;
  const { x, y } = createBatch(batchStart);
  try {
    const currentClient = client;
    if (!currentClient) throw new Error("Worker was disposed before the scenario started");
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
  streamTimer = window.setInterval(() => {
    if (appendWork) return;
    appendWork = appendNextBatch(expectedRunIdentity).finally(() => {
      appendWork = null;
    });
  }, STREAM_INTERVAL_MS);
}

async function runMeasuredScenario(): Promise<void> {
  if (!client || !initializationMeasurement || !sessionState) return;
  scenarioButton.disabled = true;
  scenarioRunning = true;
  exportButton.disabled = true;
  for (const control of viewportControls) control.disabled = true;
  scenarioStatus.textContent = "Running the local worker → renderer scenario…";

  const wasPaused = paused;
  const wasFollowing = followLatest;
  const savedBackend = backend.value;
  const savedDomain = { min: domainMin, max: domainMax };
  const savedCanvasWidth = canvas.style.width;
  setPaused(true);
  await appendWork;
  if (streamTimer !== null) window.clearInterval(streamTimer);
  streamTimer = null;

  let frameRecorder: ReturnType<typeof startFrameGapRecording> | null = null;
  try {
    // A measured run always starts from the same seeded million-point state,
    // independent of how long the interactive stream ran beforehand.
    await resetScenario(false);
    scenarioButton.disabled = true;
    exportButton.disabled = true;
    for (const control of viewportControls) control.disabled = true;
    scenarioStatus.textContent = "Running the local worker → renderer scenario…";
    const scenarioStartSourceIndex = nextSourceIndex;
    const scenarioStartRevision = sessionState?.sourceRevision ?? 0;
    frameRecorder = startFrameGapRecording();
    const viewSamples: ViewMeasurement[] = [];
    const appendSamples: AppendMeasurement[] = [];
    const comparedOutputs: Array<{
      js: { x: Float64Array; y: Float64Array };
      wasm: { x: Float64Array; y: Float64Array };
    }> = [];
    const span = INITIAL_VIEW_POINTS - 1;
    domainMax = nextSourceIndex - 1;
    domainMin = domainMax - span;
    const currentClient = client;
    const burstRequests = [0.12, 0.08, 0].map((offset) =>
      currentClient.view({
        xMin: sourceX(domainMin - Math.round(span * offset)),
        xMax: sourceX(domainMax - Math.round(span * offset)),
        widthCssPixels: Math.max(1, canvas.getBoundingClientRect().width),
        devicePixelRatio: window.devicePixelRatio || 1,
      }),
    );
    const burstOutcomes = await Promise.allSettled(burstRequests);
    const viewportBurst = {
      requested: burstOutcomes.length,
      superseded: burstOutcomes.filter(
        (outcome) =>
          outcome.status === "rejected" &&
          outcome.reason instanceof TimeSeriesWorkerSupersededError,
      ).length,
      fulfilled: burstOutcomes.filter((outcome) => outcome.status === "fulfilled").length,
    };
    if (viewportBurst.superseded !== 2 || viewportBurst.fulfilled !== 1) {
      throw new Error("The bounded viewport burst did not settle as one latest result");
    }

    for (const requestedBackend of ["js", "wasm"] as const) {
      const warmup = await requestAndRender(requestedBackend, "warmup");
      viewSamples.push(warmup.measurement);
    }

    const repetitionsPerBackend = 3;
    for (let repetition = 0; repetition < repetitionsPerBackend; repetition += 1) {
      const js = await requestAndRender("js", "viewport");
      const wasm = await requestAndRender("wasm", "viewport");
      viewSamples.push(js.measurement, wasm.measurement);
      comparedOutputs.push({ js, wasm });
    }

    const viewportWidths = [320, 960];
    for (const width of viewportWidths) {
      canvas.style.width = `${width}px`;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const js = await requestAndRender("js", "resize");
      const wasm = await requestAndRender("wasm", "resize");
      viewSamples.push(js.measurement, wasm.measurement);
      comparedOutputs.push({ js, wasm });
    }
    canvas.style.width = savedCanvasWidth;

    if (!sessionState) throw new Error("Session state was unavailable during the scenario");
    let latestState: TimeSeriesSessionState = sessionState;
    for (let repetition = 0; repetition < repetitionsPerBackend; repetition += 1) {
      const sourceStartIndex = nextSourceIndex;
      const batch = createBatch(sourceStartIndex);
      const appendStarted = performance.now();
      const appended = await currentClient.append(batch.x, batch.y, { transfer: true });
      const appendCompleted = performance.now();
      nextSourceIndex += STREAM_BATCH_POINTS;
      latestState = appended.value;
      updateState(latestState);
      appendSamples.push({
        phase: "steady-stream-append",
        label: "warm",
        sourceRevision: latestState.sourceRevision,
        sourceStartIndex,
        points: STREAM_BATCH_POINTS,
        workerProcessingMs: appended.workerProcessingMs,
        roundTripMs: appendCompleted - appendStarted,
      });
      domainMax = nextSourceIndex - 1;
      domainMin = domainMax - span;

      const js = await requestAndRender("js", "steady-stream");
      const wasm = await requestAndRender("wasm", "steady-stream");
      viewSamples.push(js.measurement, wasm.measurement);
      comparedOutputs.push({ js, wasm });
    }

    frameRecorder.stop();
    const summaries = summarizeMeasurements(viewSamples, frameRecorder.gaps);
    const p95CallerToRenderMs = summaries.callerToRenderCompletionMs.p95;
    const parity = compareOutputs(comparedOutputs);
    const comparedResultBytes = comparedOutputs.reduce(
      (total, pair) =>
        total +
        pair.js.x.byteLength +
        pair.js.y.byteLength +
        pair.wasm.x.byteLength +
        pair.wasm.y.byteLength,
      0,
    );
    latestScenarioReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      package: { name: "@vizcrush/downsample", version: DOWNSAMPLE_PACKAGE_VERSION },
      environment: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
      },
      source: {
        initialGenerator: "lcg-1664525-seed-7",
        streamGenerator: "index-hash-1664525",
        initialPoints: INITIAL_POINT_COUNT,
        retentionCapacity: RETENTION_CAPACITY,
        streamBatchPoints: STREAM_BATCH_POINTS,
        timestampStart: SOURCE_START,
        timestampStepMs: SOURCE_STEP_MS,
        scenarioStartSourceIndex,
        scenarioStartRevision,
      },
      parameters: {
        repetitionsPerBackend,
        viewportWidths,
        requestedBackends: ["js", "wasm"],
      },
      initialization: initializationMeasurement,
      viewportBurst,
      viewSamples,
      appendSamples,
      frameGapsMs: frameRecorder.gaps,
      summaries,
      parity,
      bufferAccounting: {
        ...latestState.bufferBytes,
        appOwnedPendingBatchBytes: STREAM_BATCH_POINTS * Float64Array.BYTES_PER_ELEMENT * 2,
        comparedResultBytes,
      },
      provisionalTarget: {
        p95CallerToRenderMs,
        targetMs: 100,
        met: p95CallerToRenderMs <= 100,
      },
      notes: [
        "Measurements cover this browser, device, seeded source, public worker client, session, and Canvas renderer only.",
        "Frame gaps are observed main-thread intervals, not isolated kernel timings.",
        "Buffer accounting covers named typed arrays and retained comparison results, not total browser heap.",
        "No telemetry is sent; export remains local to this browser.",
        "Requested backend and actual backend are recorded separately; an unavailable WASM request may execute the JS fallback.",
        p95CallerToRenderMs <= 100
          ? "The provisional 100 ms p95 interaction target was met on this run; this is not a portable guarantee."
          : "The provisional 100 ms p95 interaction target was missed on this run; no responsiveness claim should be inferred.",
      ],
    };
    exportButton.disabled = false;
    scenarioStatus.textContent = `${viewSamples.length} raw view samples · p95 caller-to-render ${p95CallerToRenderMs.toFixed(1)} ms · ${parity.identicalPairs}/${parity.comparedPairs} forced-request pairs numerically identical. Results stay local until exported.`;
  } catch (error) {
    frameRecorder?.stop();
    scenarioStatus.textContent = `Scenario failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    canvas.style.width = savedCanvasWidth;
    backend.value = savedBackend;
    setFollowLatest(wasFollowing);
    if (wasFollowing) {
      const span = savedDomain.max - savedDomain.min;
      domainMax = nextSourceIndex - 1;
      domainMin = domainMax - span;
    } else {
      domainMin = savedDomain.min;
      domainMax = savedDomain.max;
    }
    setPaused(wasPaused);
    if (!wasPaused) startStream(runIdentity);
    scenarioButton.disabled = false;
    scenarioRunning = false;
    for (const control of viewportControls) control.disabled = false;
    await render().catch(showWorkerError);
  }
}

function exportScenarioResults(): void {
  if (!latestScenarioReport) return;
  downloadScenarioReport(latestScenarioReport);
}

async function resetScenario(startStreaming = true): Promise<void> {
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
  latestScenarioReport = null;
  exportButton.disabled = true;
  scenarioStatus.textContent = "Run the measured scenario to create a local export.";
  status.textContent = "Generating and retaining 1,000,000 points in one persistent worker…";
  const initializationStarted = performance.now();
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const nextClient = new TimeSeriesWorkerClient(worker);
  client = nextClient;
  const stateRequestStarted = performance.now();
  const stateResponse = await nextClient.state();
  const initializedAt = performance.now();
  if (expectedRunIdentity !== runIdentity) return;
  initializationMeasurement = {
    label: "cold",
    workerSetupAndInitialLoadMs: initializedAt - initializationStarted,
    stateRoundTripMs: initializedAt - stateRequestStarted,
    workerProcessingMs: stateResponse.workerProcessingMs,
    sourceRevision: stateResponse.value.sourceRevision,
  };
  updateState(stateResponse.value);
  await render();
  if (startStreaming) startStream(expectedRunIdentity);
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
resetButton.addEventListener("click", () => void resetScenario());
scenarioButton.addEventListener("click", () => void runMeasuredScenario());
exportButton.addEventListener("click", exportScenarioResults);
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
  if (client && !scenarioRunning) void render().catch(showWorkerError);
}).observe(canvas);
void resetScenario().catch(showWorkerError);
