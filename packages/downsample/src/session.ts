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
  /** Maximum number of points accepted by one append. Defaults to capacity. */
  maxIngestionBatchPoints?: number;
  /** Target points per physical pixel. Default: 1. */
  pointsPerPixel?: number;
}

export interface TimeSeriesBufferAccounting {
  /** Bytes currently occupied by retained x/y values. */
  retainedSourceBytes: number;
  /** Bytes reserved by the fixed-capacity x/y source buffers. */
  sourceCapacityBytes: number;
  /** Bytes reserved by reusable x/y linearization scratch buffers. */
  scratchCapacityBytes: number;
  /** Maximum bytes in one unacknowledged x/y append batch. */
  pendingAppendCapacityBytes: number;
  /** Maximum bytes in caller-owned x/y viewport result buffers. */
  outputCapacityBytes: number;
  /** Sum of the separately accounted capacity bounds above, excluding retainedSourceBytes. */
  totalAccountedCapacityBytes: number;
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
  maxIngestionBatchPoints: number;
  pointsPerPixel: number;
  retainedPoints: number;
  oldestX: number | null;
  newestX: number | null;
  sourceRevision: number;
  bufferBytes: TimeSeriesBufferAccounting;
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
  /** Bytes owned by this result's paired output buffers. */
  outputBytes: number;
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
    outputBytes: 0,
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
  readonly #maxIngestionBatchPoints: number;
  readonly #pointsPerPixel: number;
  readonly #x: Float64Array;
  readonly #y: Float64Array;
  readonly #scratchX: Float64Array;
  readonly #scratchY: Float64Array;
  #start = 0;
  #length = 0;
  #sourceRevision = 0;

  constructor(options: TimeSeriesSessionOptions) {
    if (options === null || typeof options !== "object") {
      throw new TypeError("options are required");
    }
    this.#capacity = positiveInteger(options.capacity, "capacity");
    this.#maxOutputPoints = positiveInteger(options.maxOutputPoints, "maxOutputPoints");
    this.#maxIngestionBatchPoints = positiveInteger(
      options.maxIngestionBatchPoints ?? options.capacity,
      "maxIngestionBatchPoints",
    );
    this.#pointsPerPixel = positiveFinite(options.pointsPerPixel ?? 1, "pointsPerPixel");
    this.#x = new Float64Array(this.#capacity);
    this.#y = new Float64Array(this.#capacity);
    this.#scratchX = new Float64Array(this.#capacity);
    this.#scratchY = new Float64Array(this.#capacity);
  }

  /** Current externally observable retention and configuration state. */
  get state(): TimeSeriesSessionState {
    const sourceCapacityBytes = this.#capacity * Float64Array.BYTES_PER_ELEMENT * 2;
    const scratchCapacityBytes = this.#capacity * Float64Array.BYTES_PER_ELEMENT * 2;
    const pendingAppendCapacityBytes =
      this.#maxIngestionBatchPoints * Float64Array.BYTES_PER_ELEMENT * 2;
    const outputCapacityBytes =
      Math.min(this.#capacity, this.#maxOutputPoints) * Float64Array.BYTES_PER_ELEMENT * 2;
    return {
      capacity: this.#capacity,
      maxOutputPoints: this.#maxOutputPoints,
      maxIngestionBatchPoints: this.#maxIngestionBatchPoints,
      pointsPerPixel: this.#pointsPerPixel,
      retainedPoints: this.#length,
      oldestX: this.#length === 0 ? null : this.#x[this.#start],
      newestX: this.#length === 0 ? null : this.#x[this.#physicalIndex(this.#length - 1)],
      sourceRevision: this.#sourceRevision,
      bufferBytes: {
        retainedSourceBytes: this.#length * Float64Array.BYTES_PER_ELEMENT * 2,
        sourceCapacityBytes,
        scratchCapacityBytes,
        pendingAppendCapacityBytes,
        outputCapacityBytes,
        totalAccountedCapacityBytes:
          sourceCapacityBytes +
          scratchCapacityBytes +
          pendingAppendCapacityBytes +
          outputCapacityBytes,
      },
    };
  }

  /** Replace history with a safe copy, retaining the newest capacity points. */
  load(x: Float64Array, y: Float64Array): TimeSeriesSessionState {
    validateSeries(x, y);
    const retained = Math.min(x.length, this.#capacity);
    const start = x.length - retained;
    this.#x.set(x.subarray(start), 0);
    this.#y.set(y.subarray(start), 0);
    this.#start = 0;
    this.#length = retained;
    this.#sourceRevision += 1;
    return this.state;
  }

  /**
   * Append one validated nondecreasing batch and evict the oldest paired
   * points when fixed retention capacity is exceeded.
   */
  append(x: Float64Array, y: Float64Array): TimeSeriesSessionState {
    validateSeries(x, y);
    if (x.length > this.#maxIngestionBatchPoints) {
      throw new RangeError(
        `append batch length must not exceed maxIngestionBatchPoints (${this.#maxIngestionBatchPoints})`,
      );
    }
    if (x.length === 0) return this.state;
    const newestX = this.#length === 0 ? null : this.#x[this.#physicalIndex(this.#length - 1)];
    if (newestX !== null && x[0] < newestX) {
      throw new RangeError("appended x values must not precede the last retained timestamp");
    }

    if (x.length >= this.#capacity) {
      const inputStart = x.length - this.#capacity;
      this.#x.set(x.subarray(inputStart), 0);
      this.#y.set(y.subarray(inputStart), 0);
      this.#start = 0;
      this.#length = this.#capacity;
    } else {
      const evicted = Math.max(0, this.#length + x.length - this.#capacity);
      if (evicted > 0) {
        this.#start = this.#physicalIndex(evicted);
        this.#length -= evicted;
      }
      const writeStart = this.#physicalIndex(this.#length);
      const firstLength = Math.min(x.length, this.#capacity - writeStart);
      this.#x.set(x.subarray(0, firstLength), writeStart);
      this.#y.set(y.subarray(0, firstLength), writeStart);
      if (firstLength < x.length) {
        this.#x.set(x.subarray(firstLength), 0);
        this.#y.set(y.subarray(firstLength), 0);
      }
      this.#length += x.length;
    }
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

    this.#linearize();
    const visibleStart = lowerBound(this.#scratchX, this.#length, xMin);
    const visibleEnd = upperBound(this.#scratchX, this.#length, xMax);
    const selectedStart = visibleStart > 0 ? visibleStart - 1 : visibleStart;
    const selectedEnd = visibleEnd < this.#length ? visibleEnd + 1 : visibleEnd;
    const visiblePoints = visibleEnd - visibleStart;
    const edgeNeighborPoints =
      (selectedStart < visibleStart ? 1 : 0) + (selectedEnd > visibleEnd ? 1 : 0);
    const selectedPoints = selectedEnd - selectedStart;
    if (selectedPoints === 0) {
      return emptyResult(this.#sourceRevision, pointBudget, requestedBackend);
    }

    const selectedX = this.#scratchX.subarray(selectedStart, selectedEnd);
    const selectedY = this.#scratchY.subarray(selectedStart, selectedEnd);
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
        outputBytes: selectedPoints * Float64Array.BYTES_PER_ELEMENT * 2,
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
        outputBytes: Float64Array.BYTES_PER_ELEMENT * 2,
      };
    }

    const execution = await downsampleKernels.lttb.withBackend(
      selectedX,
      selectedY,
      pointBudget,
      options,
    );
    const result = {
      ...execution.result,
      ...metadata,
      requestedBackend: execution.requestedBackend,
      backend: execution.backend,
      reason: execution.reason,
    };
    return {
      ...result,
      outputBytes: result.x.byteLength + result.y.byteLength,
    };
  }

  #physicalIndex(logicalIndex: number): number {
    return (this.#start + logicalIndex) % this.#capacity;
  }

  #linearize(): void {
    if (this.#length === 0) return;
    const firstLength = Math.min(this.#length, this.#capacity - this.#start);
    this.#scratchX.set(this.#x.subarray(this.#start, this.#start + firstLength), 0);
    this.#scratchY.set(this.#y.subarray(this.#start, this.#start + firstLength), 0);
    if (firstLength < this.#length) {
      const remaining = this.#length - firstLength;
      this.#scratchX.set(this.#x.subarray(0, remaining), firstLength);
      this.#scratchY.set(this.#y.subarray(0, remaining), firstLength);
    }
  }
}
