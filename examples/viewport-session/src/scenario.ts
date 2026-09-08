import type { KernelBackend } from "@vizcrush/core";
import type { TimeSeriesSessionState } from "@vizcrush/downsample/session";

export const DOWNSAMPLE_PACKAGE_VERSION = "1.1.0" as const;

export interface InitializationMeasurement {
  label: "cold";
  workerSetupAndInitialLoadMs: number;
  stateRoundTripMs: number;
  workerProcessingMs: number;
  sourceRevision: number;
}

export interface ViewMeasurement {
  phase: "warmup" | "viewport" | "resize" | "steady-stream";
  label: "warmup" | "warm";
  requestedBackend: KernelBackend;
  actualBackend: "wasm" | "js" | null;
  reason: string;
  sourceRevision: number;
  domain: { xMin: number; xMax: number };
  widthCssPixels: number;
  outputPoints: number;
  workerProcessingMs: number;
  roundTripMs: number;
  callerToRenderCompletionMs: number;
  rendererMs: number;
}

export interface AppendMeasurement {
  phase: "steady-stream-append";
  label: "warm";
  sourceRevision: number;
  sourceStartIndex: number;
  points: number;
  workerProcessingMs: number;
  roundTripMs: number;
}

interface Percentiles {
  p50: number;
  p95: number;
}

export interface ScenarioReport {
  schemaVersion: 1;
  generatedAt: string;
  package: { name: "@vizcrush/downsample"; version: typeof DOWNSAMPLE_PACKAGE_VERSION };
  environment: {
    userAgent: string;
    language: string;
    hardwareConcurrency: number | null;
  };
  source: {
    initialGenerator: "lcg-1664525-seed-7";
    streamGenerator: "index-hash-1664525";
    initialPoints: number;
    retentionCapacity: number;
    streamBatchPoints: number;
    timestampStart: number;
    timestampStepMs: number;
    scenarioStartSourceIndex: number;
    scenarioStartRevision: number;
  };
  parameters: {
    repetitionsPerBackend: number;
    viewportWidths: number[];
    requestedBackends: ["js", "wasm"];
  };
  initialization: InitializationMeasurement;
  viewportBurst: { requested: number; superseded: number; fulfilled: number };
  viewSamples: ViewMeasurement[];
  appendSamples: AppendMeasurement[];
  frameGapsMs: number[];
  summaries: {
    workerRoundTripMs: Percentiles;
    rendererMs: Percentiles;
    callerToRenderCompletionMs: Percentiles;
    frameGapMs: Percentiles;
  };
  parity: { comparedPairs: number; identicalPairs: number; maximumYDelta: number };
  bufferAccounting: TimeSeriesSessionState["bufferBytes"] & {
    appOwnedPendingBatchBytes: number;
    comparedResultBytes: number;
  };
  provisionalTarget: { p95CallerToRenderMs: number; targetMs: 100; met: boolean };
  notes: string[];
}

/** Calculate nearest-rank p50 and p95 values for a set of nonempty or empty samples. */
export function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { p50: 0, p95: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  const at = (quantile: number) => sorted[Math.ceil(sorted.length * quantile) - 1];
  return { p50: at(0.5), p95: at(0.95) };
}

/** Summarize warm viewport latency boundaries and observed animation-frame gaps. */
export function summarizeMeasurements(
  samples: ViewMeasurement[],
  frameGapsMs: number[],
): ScenarioReport["summaries"] {
  const warm = samples.filter((sample) => sample.label === "warm");
  return {
    workerRoundTripMs: percentiles(warm.map((sample) => sample.roundTripMs)),
    rendererMs: percentiles(warm.map((sample) => sample.rendererMs)),
    callerToRenderCompletionMs: percentiles(
      warm.map((sample) => sample.callerToRenderCompletionMs),
    ),
    frameGapMs: percentiles(frameGapsMs),
  };
}

/** Compare paired JS and WASM outputs element-by-element and report their largest y delta. */
export function compareOutputs(
  pairs: Array<{
    js: { x: Float64Array; y: Float64Array };
    wasm: { x: Float64Array; y: Float64Array };
  }>,
): ScenarioReport["parity"] {
  let identicalPairs = 0;
  let maximumYDelta = 0;
  for (const pair of pairs) {
    let identical = pair.js.x.length === pair.wasm.x.length;
    const length = Math.min(pair.js.y.length, pair.wasm.y.length);
    for (let index = 0; index < length; index += 1) {
      if (pair.js.x[index] !== pair.wasm.x[index] || pair.js.y[index] !== pair.wasm.y[index]) {
        identical = false;
      }
      maximumYDelta = Math.max(maximumYDelta, Math.abs(pair.js.y[index] - pair.wasm.y[index]));
    }
    if (identical) identicalPairs += 1;
  }
  return { comparedPairs: pairs.length, identicalPairs, maximumYDelta };
}

/** Record consecutive animation-frame gaps until the returned recorder is stopped. */
export function startFrameGapRecording(): { gaps: number[]; stop(): void } {
  const gaps: number[] = [];
  let previous: number | null = null;
  let active = true;
  let animationFrame = 0;
  const sample = (now: number) => {
    if (previous !== null) gaps.push(now - previous);
    previous = now;
    if (active) animationFrame = requestAnimationFrame(sample);
  };
  animationFrame = requestAnimationFrame(sample);
  return {
    gaps,
    stop() {
      active = false;
      cancelAnimationFrame(animationFrame);
    },
  };
}

/** Download a scenario report as local JSON without transmitting it. */
export function downloadScenarioReport(report: ScenarioReport): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `vizcrush-viewport-scenario-${report.generatedAt.replaceAll(":", "-")}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
