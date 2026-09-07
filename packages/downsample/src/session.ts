import type {
  DownsampleResult,
  KernelBackend,
  KernelBackendReason,
  KernelCallOptions,
} from "@vizcrush/core";
import { downsampleKernels } from "./index.js";

export interface TimeSeriesSessionOptions {
  /** Maximum number of source points retained by the session. */
  capacity: number;
  /** Hard upper bound for every viewport result. */
  maxOutputPoints: number;
  /** Target points per physical pixel. Default: 1. */
  pointsPerPixel?: number;
}

export interface ViewportRequest {
  /** Inclusive viewport domain. */
  xMin: number;
  xMax: number;
  /** Viewport width in CSS pixels. Zero returns an empty result. */
  widthCssPixels: number;
  /** Physical pixels per CSS pixel. Default: 1. */
  devicePixelRatio?: number;
}

export interface TimeSeriesSessionState {
  capacity: number;
  maxOutputPoints: number;
  pointsPerPixel: number;
  retainedPoints: number;
  sourceRevision: number;
}

export type ViewportDecisionReason = KernelBackendReason | "no-kernel";

export interface ViewportResult extends DownsampleResult {
  sourceRevision: number;
  pointBudget: number;
  selectedPoints: number;
  visiblePoints: number;
  edgeNeighborPoints: number;
  requestedBackend: KernelBackend;
  backend: "wasm" | "js" | null;
  reason: ViewportDecisionReason;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

function validateSeries(x: Float64Array, y: Float64Array): void {
  if (!(x instanceof Float64Array) || !(y instanceof Float64Array)) {
    throw new TypeError("x and y must be Float64Array instances");
  }
  if (x.length !== y.length) {
    throw new RangeError("x and y must have equal lengths");
  }
  for (let index = 0; index < x.length; index += 1) {
    if (!Number.isFinite(x[index]) || !Number.isFinite(y[index])) {
      throw new RangeError(`x and y must contain only finite values (index ${index})`);
    }
    if (index > 0 && x[index] < x[index - 1]) {
      throw new RangeError(`x must be nondecreasing (index ${index})`);
    }
  }
}

function lowerBound(values: Float64Array, length: number, target: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: Float64Array, length: number, target: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function emptyResult(
  sourceRevision: number,
  pointBudget: number,
  requestedBackend: KernelBackend,
): ViewportResult {
  return {
    x: new Float64Array(),
    y: new Float64Array(),
    sourceRevision,
    pointBudget,
    selectedPoints: 0,
    visiblePoints: 0,
    edgeNeighborPoints: 0,
    requestedBackend,
    backend: null,
    reason: "no-kernel",
  };
}

/**
 * Owns validated paired time-series history and reduces inclusive viewports to
 * a pixel-derived, hard-bounded result. Call it in a worker when main-thread
 * isolation is needed.
 */
export class TimeSeriesSession {
  readonly #capacity: number;
  readonly #maxOutputPoints: number;
  readonly #pointsPerPixel: number;
  readonly #x: Float64Array;
  readonly #y: Float64Array;
  #length = 0;
  #sourceRevision = 0;

  constructor(options: TimeSeriesSessionOptions) {
    if (options === null || typeof options !== "object") {
      throw new TypeError("options are required");
    }
    this.#capacity = positiveInteger(options.capacity, "capacity");
    this.#maxOutputPoints = positiveInteger(options.maxOutputPoints, "maxOutputPoints");
    this.#pointsPerPixel = positiveFinite(options.pointsPerPixel ?? 1, "pointsPerPixel");
    this.#x = new Float64Array(this.#capacity);
    this.#y = new Float64Array(this.#capacity);
  }

  /** Current externally observable retention and configuration state. */
  get state(): TimeSeriesSessionState {
    return {
      capacity: this.#capacity,
      maxOutputPoints: this.#maxOutputPoints,
      pointsPerPixel: this.#pointsPerPixel,
      retainedPoints: this.#length,
      sourceRevision: this.#sourceRevision,
    };
  }

  /** Replace history with a safe copy, retaining the newest capacity points. */
  load(x: Float64Array, y: Float64Array): TimeSeriesSessionState {
    validateSeries(x, y);
    const retained = Math.min(x.length, this.#capacity);
    const start = x.length - retained;
    this.#x.set(x.subarray(start), 0);
    this.#y.set(y.subarray(start), 0);
    this.#length = retained;
    this.#sourceRevision += 1;
    return this.state;
  }

  /** Select and reduce an inclusive viewport into independently owned buffers. */
  async view(request: ViewportRequest, options: KernelCallOptions = {}): Promise<ViewportResult> {
    if (request === null || typeof request !== "object") {
      throw new TypeError("viewport request is required");
    }
    const { xMin, xMax, widthCssPixels } = request;
    const devicePixelRatio = request.devicePixelRatio ?? 1;
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin > xMax) {
      throw new RangeError("viewport xMin and xMax must be finite with xMin <= xMax");
    }
    if (!Number.isFinite(widthCssPixels) || widthCssPixels < 0) {
      throw new RangeError("widthCssPixels must be a nonnegative finite number");
    }
    positiveFinite(devicePixelRatio, "devicePixelRatio");

    const requestedBackend = options.backend ?? "auto";
    const physicalTarget = Math.floor(widthCssPixels * devicePixelRatio * this.#pointsPerPixel);
    const pointBudget =
      widthCssPixels === 0 ? 0 : Math.min(this.#maxOutputPoints, Math.max(1, physicalTarget));
    if (pointBudget === 0 || this.#length === 0) {
      return emptyResult(this.#sourceRevision, pointBudget, requestedBackend);
    }

    const visibleStart = lowerBound(this.#x, this.#length, xMin);
    const visibleEnd = upperBound(this.#x, this.#length, xMax);
    const selectedStart = visibleStart > 0 ? visibleStart - 1 : visibleStart;
    const selectedEnd = visibleEnd < this.#length ? visibleEnd + 1 : visibleEnd;
    const visiblePoints = visibleEnd - visibleStart;
    const edgeNeighborPoints =
      (selectedStart < visibleStart ? 1 : 0) + (selectedEnd > visibleEnd ? 1 : 0);
    const selectedPoints = selectedEnd - selectedStart;
    if (selectedPoints === 0) {
      return emptyResult(this.#sourceRevision, pointBudget, requestedBackend);
    }

    const selectedX = this.#x.subarray(selectedStart, selectedEnd);
    const selectedY = this.#y.subarray(selectedStart, selectedEnd);
    const metadata = {
      sourceRevision: this.#sourceRevision,
      pointBudget,
      selectedPoints,
      visiblePoints,
      edgeNeighborPoints,
    };
    if (selectedPoints <= pointBudget) {
      return {
        x: new Float64Array(selectedX),
        y: new Float64Array(selectedY),
        ...metadata,
        requestedBackend,
        backend: null,
        reason: "no-kernel",
      };
    }

    if (pointBudget === 1) {
      const midpoint = xMin + (xMax - xMin) / 2;
      let chosen = 0;
      for (let index = 1; index < selectedPoints; index += 1) {
        if (Math.abs(selectedX[index] - midpoint) < Math.abs(selectedX[chosen] - midpoint)) {
          chosen = index;
        }
      }
      return {
        x: new Float64Array([selectedX[chosen]]),
        y: new Float64Array([selectedY[chosen]]),
        ...metadata,
        requestedBackend,
        backend: null,
        reason: "no-kernel",
      };
    }

    const execution = await downsampleKernels.lttb.withBackend(
      selectedX,
      selectedY,
      pointBudget,
      options,
    );
    return {
      ...execution.result,
      ...metadata,
      requestedBackend: execution.requestedBackend,
      backend: execution.backend,
      reason: execution.reason,
    };
  }
}
